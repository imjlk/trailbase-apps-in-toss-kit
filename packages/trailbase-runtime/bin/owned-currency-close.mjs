#!/usr/bin/env bun
// Never submits to Toss, opens production connections, or modifies the snapshot.
import { Database } from 'bun:sqlite';
import { readFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildOwnedCurrencyReport, formatOwnedCurrencyCsv } from '../src/owned-currency-report.mjs';
import { reconcileOwnedCurrency } from '../src/owned-currency-reconcile.mjs';
import { sha256ReportBytes, validateOwnedCurrencyCloseManifest } from '../src/owned-currency-close-manifest.mjs';

let db;
try {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--db' || args[2] !== '--config' || args[4] !== '--out') throw Error('INVALID_ARGUMENTS');
  const config = JSON.parse(readFileSync(args[3], 'utf8'));
  const kit = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const git = (...a) => { const r=spawnSync('git',['-C',kit,...a],{encoding:'utf8'}); if(r.status!==0) throw Error('SOURCE_UNAVAILABLE'); return r.stdout.trim(); };
  if (realpathSync(git('rev-parse','--show-toplevel')) !== realpathSync(kit) || git('status','--porcelain','--untracked-files=no')) throw Error('COMMITTED_KIT_REQUIRED');
  const sourceCommit=git('rev-parse','HEAD');
  const version=JSON.parse(readFileSync(resolve(kit,'packages/trailbase-runtime/package.json'),'utf8')).version;
  db = new Database(realpathSync(args[1]), { readonly:true, strict:true });
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=3000;');
  const {report,reconciliation} = db.transaction(() => ({
    report:buildOwnedCurrencyReport({db,...config.period,timestampUnit:config.timestampUnit,
      periodStart:config.period?.start,periodEnd:config.period?.end,approvalRevision:config.approvalRevision??null}),
    reconciliation:reconcileOwnedCurrency({db,periodStart:config.period?.start,periodEnd:config.period?.end,approvalRevision:config.approvalRevision??null}),
  }))();
  report.tool={name:'trailbase-owned-currency-close',version,sourceCommit,reportedServerVersion:null};
  const reportBytes=JSON.stringify(report,null,2)+'\n';
  const policyVersions=[...new Set(report.lines.map(l=>l.policyVersion))].sort();
  const ready = policyVersions.length > 0 && reconciliation.ok && Object.values(report.quality).every(n=>n===0);
  // Operator-supplied approvalRevision is evidence, never inferred from payout success.
  const manifest={
    schemaVersion:1,reportSchemaVersion:report.schemaVersion,reportFormat:'json',
    reportRevision:config.reportRevision,appId:config.appId,period:report.period,timestampUnit:config.timestampUnit,
    timezone:config.timezone,reportSha256:sha256ReportBytes(reportBytes),snapshotRef:config.snapshotRef,
    sourceCommit,tool:{name:report.tool.name,version},policyVersions,
    approvalRevision:config.approvalRevision,
    records:[{status:'GENERATED',recordedAt:report.generatedAt,evidenceRef:'report-generated'}],
    correctionOf:config.correctionOf??null,
  };
  let manifestValid=false;
  if(ready) { validateOwnedCurrencyCloseManifest(manifest,{reportBytes}); manifestValid=true; }
  // mkdir is exclusive: a correction must use a new directory/revision.
  mkdirSync(args[5],{mode:0o700});
  const write=(name,value)=>writeFileSync(resolve(args[5],name),value,{flag:'wx',mode:0o600});
  write('report.json',reportBytes);write('report.csv',formatOwnedCurrencyCsv(report));
  write('reconciliation.json',JSON.stringify(reconciliation,null,2)+'\n');
  if(manifestValid) write('manifest.json',JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({generated:true,readyForReview:manifestValid,submitted:false}));
  if(!manifestValid) process.exitCode=2;
} catch { console.error('OWNED_CURRENCY_CLOSE_FAILED: check arguments, private adapter views, policy/approval evidence and fresh output directory');process.exitCode=2; }
finally { db?.close(); }
