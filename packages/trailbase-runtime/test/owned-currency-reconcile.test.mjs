import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {reconcileOwnedCurrency} from '../src/owned-currency-reconcile.mjs';
test('detects source and balance mismatches without exporting identities',()=>{
 const db=new Database(':memory:');
 const cols='idempotency_key TEXT,user_id BLOB,currency_code TEXT,unit_code TEXT,event_type TEXT,quantity INTEGER,policy_version TEXT,source_type TEXT,source_id TEXT,exchange_id TEXT,occurred_at INTEGER,valuation_amount INTEGER,valuation_currency_code TEXT,conversion_group_id TEXT';
 db.exec(`CREATE TABLE owned_currency_events(id TEXT,${cols}); CREATE TABLE owned_currency_expected_events(${cols});
 CREATE TABLE owned_currency_expected_balances(user_id BLOB,currency_code TEXT,unit_code TEXT,quantity INTEGER);
 CREATE TABLE owned_currency_reporting_issues(reason TEXT,occurred_at INTEGER);
 CREATE TABLE owned_currency_close_approvals(revision INTEGER);
 INSERT INTO owned_currency_expected_events VALUES('secret-source',X'01','STAR','STAR','ISSUE',10,'v1','ledger','1',NULL,1,NULL,NULL,NULL);
 INSERT INTO owned_currency_expected_balances VALUES(X'01','STAR','STAR',10);`);
 expect(reconcileOwnedCurrency({db}).checks.missingEvents).toBe(1);
 db.exec("INSERT INTO owned_currency_events SELECT 'a',* FROM owned_currency_expected_events");
 expect(reconcileOwnedCurrency({db}).ok).toBe(true);
 db.exec("UPDATE owned_currency_events SET conversion_group_id='wrong'");
 expect(reconcileOwnedCurrency({db}).checks.mismatchedEvents).toBe(1);
 db.exec("UPDATE owned_currency_events SET conversion_group_id=NULL");
 const approval=revision=>reconcileOwnedCurrency({db,approvalRevision:revision}).checks.approvalRevisionMismatch;
 expect(approval(1)).toBe(1); // Empty evidence cannot authorize a close.
 db.exec('INSERT INTO owned_currency_close_approvals VALUES(NULL)');
 expect(approval(1)).toBe(1);
 db.exec('UPDATE owned_currency_close_approvals SET revision=1');
 expect(approval(1)).toBe(0);expect(approval(0)).toBe(1);expect(approval(null)).toBe(1);
 db.exec('INSERT INTO owned_currency_close_approvals VALUES(2)');
 expect(approval(1)).toBe(1);

 db.exec("UPDATE owned_currency_events SET quantity=9");
 const result=reconcileOwnedCurrency({db});
 expect(result.checks.mismatchedEvents).toBe(1);expect(result.checks.balanceMismatches).toBe(1);
 expect(JSON.stringify(result)).not.toContain('secret-source');
 db.exec("INSERT INTO owned_currency_reporting_issues VALUES('unconfirmed',NULL)");
 expect(reconcileOwnedCurrency({db}).checks.unresolvedOperations).toBe(1);
 db.exec("DELETE FROM owned_currency_expected_events");
 expect(reconcileOwnedCurrency({db}).checks.unexpectedEvents).toBe(1); db.close();
});
test('detects swapped conversion pairs even when each pair balances',()=>{
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE owned_currency_events(id TEXT,idempotency_key TEXT,user_id BLOB,currency_code TEXT,unit_code TEXT,event_type TEXT,quantity INTEGER,policy_version TEXT,source_type TEXT,source_id TEXT,exchange_id TEXT,occurred_at INTEGER,valuation_amount INTEGER,valuation_currency_code TEXT,conversion_group_id TEXT);
 CREATE TABLE owned_currency_expected_balances(user_id BLOB,currency_code TEXT,unit_code TEXT,quantity INTEGER);
 CREATE TABLE owned_currency_reporting_issues(occurred_at INTEGER);
 INSERT INTO owned_currency_events VALUES
 ('1','1',NULL,'A','A','CONVERT_OUT',-1,'v1','convert','1',NULL,1,NULL,NULL,'pair1'),
 ('2','2',NULL,'B','B','CONVERT_IN',1,'v1','convert','2',NULL,1,NULL,NULL,'pair1'),
 ('3','3',NULL,'A','A','CONVERT_OUT',-1,'v1','convert','3',NULL,1,NULL,NULL,'pair2'),
 ('4','4',NULL,'B','B','CONVERT_IN',1,'v1','convert','4',NULL,1,NULL,NULL,'pair2');
 CREATE TABLE owned_currency_expected_events AS SELECT * FROM owned_currency_events;`);
 expect(reconcileOwnedCurrency({db}).ok).toBe(true);
 db.exec("UPDATE owned_currency_events SET conversion_group_id=CASE conversion_group_id WHEN 'pair1' THEN 'pair2' ELSE 'pair1' END WHERE event_type='CONVERT_IN'");
 expect(reconcileOwnedCurrency({db}).checks.mismatchedEvents).toBe(2);
 db.close();
});
