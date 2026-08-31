// =============================================================================
// results-file-lifecycle.spec.mjs — Validation Phase 6.5.5.4 (fichiers de résultats)
// Exécute le VRAI js/services/resultFileService.js contre Supabase distant.
// Nécessite : Node 18+ (fetch natif) et @supabase/supabase-js installé (npm i).
//
// PRÉPARATION (une fois) :
//   • Créer deux comptes de test (admin + editor) avec les bons rôles en DB
//     (cf. docs/results-file-lifecycle-phase-6554-report.md).
//   • Coller leurs JWT sign-in dans C:/Users/ken/AppData/Local/Temp/opencode/
//     ip7_admin.txt et ip7_editor.txt (ou variables d'env IPP_ADMIN_TOKEN / ...).
//
// CORRECTIF DOCUMENTÉ (Phase 6.5.5.4) :
//   reconcileResultFiles comparait file_path "results/{pubId}/..." APRÈS avoir retiré
//   le préfixe "results/" (→ "{pubId}/...") alors que le listing Storage (relatif au
//   bucket) renvoie justement "results/{pubId}/...". Résultat : TOUT fichier apparaissait
//   comme orphelin / manquant. Désormais on compare SANS transformation.
// =============================================================================
import { resultFileService } from "./lib/resultFileService.local.mjs";
import { ADMIN_TOKEN, EDITOR_TOKEN, SUPABASE_URL, SUPABASE_ANON } from "./lib/supabaseClient.local.mjs";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adminClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: "Bearer " + ADMIN_TOKEN } } });
const editorClient = createClient(SUPABASE_URL, SUPABASE_ANON, { global: { headers: { Authorization: "Bearer " + EDITOR_TOKEN } } });
const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });

const EXCEL = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const xlsxBytes = fs.readFileSync(path.join(__dirname, "fixtures", "test_results.xlsx"));
const pdfBytes = fs.readFileSync(path.join(__dirname, "fixtures", "test_results.pdf"));
function file(name, bytes, type){ return { name, size: bytes.length, type, slice: undefined }; }

let pass=0, fail=0;
function check(name, cond, extra){ if(cond){ pass++; console.log("  PASS  "+name);} else { fail++; console.log("  FAIL  "+name+(extra?("  :: "+extra):"")); } }
function errMsg(r){ return r?.error?.code+":"+r?.error?.message+(r?.cleanupWarning?(" [warn]"+r.cleanupWarning.reason):""); }

async function listAll(prefix=""){
  const { data, error } = await adminClient.storage.from("results").list(prefix||"");
  if(error) return [];
  let out=[];
  for(const e of data||[]){ if(e.id) out.push(prefix?`${prefix}/${e.name}`:e.name); else out.push(...await listAll(prefix?`${prefix}/${e.name}`:e.name)); }
  return out;
}

const cls = "TST" + Math.floor(10000+Math.random()*89999);
const pb = await adminClient.from("result_publications").insert({ level_name:"Première", class_name:cls, session:"T2", school_year:"2026", status:"draft" }).select().single();
if(pb.error){ console.error("PUB CREATE FAILED: "+pb.error.message); process.exit(1); }
const pub = { id: pb.data.id };
console.log("Test publication "+cls+" id="+pub.id);

console.log("\nT1/T2 — multi-file upload");
const u1 = await resultFileService.uploadResultFile(pub, file("resultats.xlsx", xlsxBytes, EXCEL));
check("upload xlsx SUCCESS", u1.success===true, errMsg(u1));
const u2 = await resultFileService.uploadResultFile(pub, file("annexe.pdf", pdfBytes, "application/pdf"));
check("upload pdf SUCCESS", u2.success===true, errMsg(u2));
const uBad = await resultFileService.uploadResultFile(pub, file("malware.exe", [0,1,2], "application/octet-stream"));
check("upload .exe REJECTED", uBad.success===false && uBad.error.code==="INVALID_FILE");
const files = await resultFileService.listPublicationFiles(pub.id);
check("list returns 2 files", files.length===2);
const dbRows = (await adminClient.from("result_files").select("*").eq("publication_id", pub.id)).data||[];
check("result_files has 2 rows", dbRows.length===2);
check("DB file_path === storage key (results/…)", dbRows.every(r=>r.file_path.startsWith("results/"+pub.id+"/")));

console.log("\nRECONCILE (admin)");
const rec = await resultFileService.reconcileResultFiles();
check("reconcile: DB rows for mine = 2", rec.dbFiles.filter(r=>r.file_path.startsWith("results/"+pub.id+"/")).length===2);
check("reconcile: storage files for mine = 2", rec.storageFiles.filter(p=>p.startsWith("results/"+pub.id+"/")).length===2);
check("reconcile: no missingInStorage for mine", rec.missingInStorage.filter(r=>r.file_path.startsWith("results/"+pub.id+"/")).length===0);
check("reconcile: no orphanedInStorage for mine", rec.orphanedInStorage.filter(p=>p.startsWith("results/"+pub.id+"/")).length===0);

console.log("\nT3 — delete individual file");
const del1 = await resultFileService.deleteResultFile(u2.file.id);
check("delete pdf SUCCESS", del1.success===true, errMsg(del1));
const filesAfter = await resultFileService.listPublicationFiles(pub.id);
check("1 file remains after delete", filesAfter.length===1 && filesAfter[0].id===u1.file.id);
const del404 = await resultFileService.deleteResultFile("11111111-1111-1111-1111-111111111111");
check("delete non-existent -> NOT_FOUND", del404.success===false && del404.error.code==="NOT_FOUND");

console.log("\nT4 — replace remaining file");
const rep = await resultFileService.replaceResultFile(pub, u1.file.id, file("nouveau.xlsx", xlsxBytes, EXCEL));
check("replace SUCCESS", rep.success===true, errMsg(rep));
check("replace no cleanupWarning", !rep.cleanupWarning, rep?.cleanupWarning?.reason);
const filesRep = await resultFileService.listPublicationFiles(pub.id);
check("replace: still 1 file", filesRep.length===1);
check("replace: file_name updated", filesRep[0].file_name==="nouveau.xlsx");
const rec2 = await resultFileService.reconcileResultFiles();
check("reconcile after replace: no missing", rec2.missingInStorage.filter(r=>r.file_path.startsWith("results/"+pub.id+"/")).length===0);
check("reconcile after replace: no orphan", rec2.orphanedInStorage.filter(p=>p.startsWith("results/"+pub.id+"/")).length===0);

console.log("\nRLS — editor blocked");
const edUp = await editorClient.storage.from("results").upload("results/"+pub.id+"/editor_try.xlsx", new Blob([xlsxBytes],{type:EXCEL}), {upsert:false});
check("editor storage UPLOAD blocked", !!edUp.error, edUp.error?.message);
const edIns = await editorClient.from("result_files").insert({ publication_id:pub.id, file_path:"results/x.xlsx", file_name:"x.xlsx", file_type:EXCEL, file_size:10 });
check("editor result_files INSERT blocked", !!edIns.error, edIns.error?.message);
const cur = filesRep[0].id;
await editorClient.from("result_files").delete().eq("id", cur);
const curCheck = (await adminClient.from("result_files").select("id").eq("id", cur)).data||[];
check("editor result_files DELETE affects 0 rows (preserved)", curCheck.length===1, "rows="+curCheck.length);
const erp = "results/"+pub.id+"/editor_rm.xlsx";
await adminClient.storage.from("results").upload(erp, new Blob([xlsxBytes],{type:EXCEL}), {upsert:false});
const edRm = await editorClient.storage.from("results").remove([erp]);
check("editor storage DELETE denied (object remains)", (await listAll()).includes(erp)===true || !!edRm.error);
await adminClient.storage.from("results").remove([erp]);

console.log("\nRLS — anon blocked");
const anonRead = await anonClient.from("result_files").select("id").limit(5);
check("anon result_files returns 0 rows (no leak)", (anonRead.data||[]).length===0, "rows="+(anonRead.data||[]).length);
const anonUp = await anonClient.storage.from("results").upload("results/"+pub.id+"/anon.xlsx", new Blob([xlsxBytes],{type:EXCEL}), {upsert:false});
check("anon storage UPLOAD blocked", !!anonUp.error, anonUp.error?.message);

console.log("\nT6 — delete publication (cascade + storage)");
const delPub = await resultFileService.deletePublication(pub);
check("deletePublication SUCCESS", delPub.success===true, JSON.stringify(delPub));
check("result_files cascade-deleted", ((await adminClient.from("result_files").select("id").eq("publication_id", pub.id)).data||[]).length===0);
check("publication storage cleaned", (await listAll()).filter(p=>p.startsWith("results/"+pub.id+"/")).length===0);

console.log("\n==== RESULT: "+pass+" PASS / "+fail+" FAIL ====");
process.exit(fail>0?1:0);
