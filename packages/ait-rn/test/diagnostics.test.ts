import { expect,test } from 'bun:test';
import { collectAppsInTossRuntimeDiagnostics } from '../src/diagnostics';
test('disabled probes nothing; reports only normalized environment metadata when enabled',async()=>{
 let calls=0; const probe=()=>{calls++;return 'secret-native-message'};
 const probes={environment:probe,platform:probe,appVersion:probe,network:probe};
 expect(await collectAppsInTossRuntimeDiagnostics({probes})).toBeNull();expect(calls).toBe(0);
 const report=await collectAppsInTossRuntimeDiagnostics({enabled:true,probes});
 expect(JSON.stringify(report)).not.toContain('secret-native-message');
 expect(report?.appVersion).toBeNull();expect(report?.deviceFeaturesVerified).toBe(false);
 expect(report?.probes.environment).toBe('unknown');
});
test('native probe failures and hangs are bounded and never become verification success',async()=>{
 const report=await collectAppsInTossRuntimeDiagnostics({enabled:true,timeoutMs:5,probes:{
   environment:()=> 'toss',platform:()=> 'ios',appVersion:()=> {throw Error('secret')},network:()=>new Promise(()=>{}),
 }});
 expect(report?.environment).toBe('toss');expect(report?.platform).toBe('ios');
 expect(report?.probes.appVersion).toBe('failed');expect(report?.probes.network).toBe('timeout');
 expect(JSON.stringify(report)).not.toContain('secret');
});
