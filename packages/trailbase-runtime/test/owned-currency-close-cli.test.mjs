import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {readFileSync,writeFileSync,mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateOwnedCurrencyCloseManifest} from '../src/owned-currency-close-manifest.mjs';
const root=resolve(import.meta.dir,'../../..');
const dirty=spawnSync('git',['-C',root,'status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).stdout.trim();
(dirty ? test.skip : test)('close creates immutable redacted artifacts, blocks unresolved issues and refuses overwrite',()=>{
 const dir=mkdtempSync(join(tmpdir(),'currency-close-'));
 try {
 const db=new Database(join(dir,'snapshot.sqlite'));
 db.exec('CREATE TABLE _user(id BLOB PRIMARY KEY); INSERT INTO _user VALUES(X\'01\');');
 for(const name of ['owned_currency_events','owned_currency_policies']) db.exec(readFileSync(join(root,'templates/trailbase/sql',name+'.sql'),'utf8'));
 db.exec("INSERT INTO owned_currency_policies(currency_code,unit_code,policy_version,valuation_mode,effective_from,created_at) VALUES('STAR','STAR','v1','NONE',0,0); INSERT INTO owned_currency_events(id,user_id,currency_code,unit_code,event_type,quantity,source_type,source_id,idempotency_key,policy_version,occurred_at,created_at) VALUES('a',X'01','STAR','STAR','ISSUE',10,'source','private-source','key','v1',1,1); CREATE TABLE owned_currency_expected_events AS SELECT * FROM owned_currency_events; CREATE VIEW owned_currency_expected_balances AS SELECT X'01' user_id,'STAR' currency_code,'STAR' unit_code,10 quantity; CREATE TABLE owned_currency_reporting_issues(reason TEXT,occurred_at INTEGER); CREATE VIEW owned_currency_close_approvals AS SELECT 1 revision;");db.close();
 const cfg={period:{start:0,end:10},timestampUnit:'milliseconds',timezone:'Asia/Seoul',appId:'fixture',reportRevision:'r1',snapshotRef:'fixture-snapshot',approvalRevision:1};
 writeFileSync(join(dir,'config.json'),JSON.stringify(cfg));
 const run=out=>spawnSync(process.execPath,[join(root,'packages/trailbase-runtime/bin/owned-currency-close.mjs'),'--db',join(dir,'snapshot.sqlite'),'--config',join(dir,'config.json'),'--out',join(dir,out)],{encoding:'utf8'});

 const first=run('first');
 expect(first.status).toBe(0);
 const bytes=readFileSync(join(dir,'first/report.json'));
 expect(bytes.toString()).not.toContain('private-source');
 expect(validateOwnedCurrencyCloseManifest(JSON.parse(readFileSync(join(dir,'first/manifest.json'),'utf8')),{reportBytes:bytes}).manifest.records.map(r=>r.status)).toEqual(['GENERATED']);
 expect(run('first').status).toBe(2);
 writeFileSync(join(dir,'config.json'),JSON.stringify({...cfg,approvalRevision:99}));
 expect(run('wrong-revision').status).toBe(2);
 expect(existsSync(join(dir,'wrong-revision/manifest.json'))).toBe(false);
 writeFileSync(join(dir,'config.json'),JSON.stringify(cfg));
 for (const timestampUnit of ['seconds','milliseconds']) {
   const end=Math.floor(Date.now()/(timestampUnit==='seconds'?1000:1))+86400000;
   writeFileSync(join(dir,'config.json'),JSON.stringify({...cfg,timestampUnit,period:{start:0,end}}));
   expect(run('future-'+timestampUnit).status).toBe(2);
   expect(existsSync(join(dir,'future-'+timestampUnit+'/manifest.json'))).toBe(false);
 }
 writeFileSync(join(dir,'config.json'),JSON.stringify(cfg));
 expect(existsSync(join(dir,'first/manifest.json.tmp'))).toBe(false);
 const edit=new Database(join(dir,'snapshot.sqlite'));edit.exec("INSERT INTO owned_currency_reporting_issues VALUES('unconfirmed',NULL)");edit.close();
 expect(run('blocked').status).toBe(2);expect(existsSync(join(dir,'blocked/report.json'))).toBe(true);expect(existsSync(join(dir,'blocked/manifest.json'))).toBe(false);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('close reports a safe argument diagnostic even in a dirty checkout',()=>{
 const result=spawnSync(process.execPath,[join(root,'packages/trailbase-runtime/bin/owned-currency-close.mjs')],{encoding:'utf8'});
 expect(result.status).toBe(2);expect(result.stderr.trim()).toBe('INVALID_ARGUMENTS');
});
