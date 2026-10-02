import { expect,test } from 'bun:test';
import { AppsInTossBundle } from '@apps-in-toss/ait-format';
import { createDeviceTestPlan,createDeviceTestScheme,inspectAitDeviceMetadata } from '../src/device-test.mjs';
const id='0198c000-68c3-7d2b-0000-2c00000005ec';
const scheme=`intoss-private://appsintoss?_deploymentId=${id}`;
test('reads app and deployment from actual AIT bytes and binds their hash', async () => {
 const writer = AppsInTossBundle.writer({ appName:'fixture-app' });
 writer.setMetadata({ runtimeVersion:'0.84.0' });
 writer.addFile('fixture.js',new TextEncoder().encode('fixture'));
 const bytes = await writer.toBuffer();
 const metadata = inspectAitDeviceMetadata(bytes);
 expect(metadata.appName).toBe('fixture-app');
 expect(metadata.deploymentId).toBe(AppsInTossBundle.reader(bytes).deploymentId);
 expect(metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
 expect(() => inspectAitDeviceMetadata(new Uint8Array([1,2,3]))).toThrow();
});
test('keeps the issued host/id and encodes nested query exactly once',()=>{
 const url=new URL(createDeviceTestScheme({scheme,deploymentId:id,path:'/poll/detail',query:{pollId:'fixture-1',source:'테스트'},allowedQueryKeys:['pollId','source']}));
 expect(url.host).toBe('appsintoss');expect(url.pathname).toBe('/poll/detail');
 expect(JSON.parse(url.searchParams.get('queryParams'))).toEqual({pollId:'fixture-1',source:'테스트'});
 expect(url.searchParams.get('_deploymentId')).toBe(id);
});
test('rejects replaced/duplicate IDs, production schemes, unsafe paths and sensitive query keys',()=>{
 for(const patch of [{deploymentId:'changed'},{scheme:scheme+'&_deploymentId='+id},{scheme:'intoss://app'},{path:'//other'},{path:'/%2e%2e/private'},{path:'/%0a'},{query:{accessToken:'secret'},allowedQueryKeys:['accessToken']},{scheme:scheme+'&token=secret'},{scheme:scheme+'&queryParams='+encodeURIComponent(JSON.stringify({accessToken:'secret'})),allowedQueryKeys:['accessToken']}])
  expect(()=>createDeviceTestScheme({scheme,deploymentId:id,...patch})).toThrow();
});
test('existing route query parameters obey the same allowlist',()=>{
 const issued = `${scheme}&queryParams=${encodeURIComponent(JSON.stringify({entry:'direct'}))}`;
 expect(()=>createDeviceTestScheme({scheme:issued,deploymentId:id})).toThrow();
 const url = new URL(createDeviceTestScheme({scheme:issued,deploymentId:id,allowedQueryKeys:['entry']}));
 expect(JSON.parse(url.searchParams.get('queryParams'))).toEqual({entry:'direct'});
});
test('route additions preserve issued query values and explicitly override matching keys',()=>{
 const issued = `${scheme}&queryParams=${encodeURIComponent(JSON.stringify({entry:'direct',source:'old'}))}`;
 const url = new URL(createDeviceTestScheme({scheme:issued,deploymentId:id,query:{pollId:'fixture-1',source:'new'},allowedQueryKeys:['entry','source','pollId']}));
 expect(JSON.parse(url.searchParams.get('queryParams'))).toEqual({entry:'direct',source:'new',pollId:'fixture-1'});
});
test('new route values cannot bypass validation or the combined query size limit',()=>{
 for (const existing of [null, ['entry'], 'direct', {entry:{nested:true}}, {accessToken:'secret'}]) {
  const issued = `${scheme}&queryParams=${encodeURIComponent(JSON.stringify(existing))}`;
  expect(()=>createDeviceTestScheme({scheme:issued,deploymentId:id,query:{entry:'direct'},allowedQueryKeys:['entry','accessToken']})).toThrow();
 }
 const issued = `${scheme}&queryParams=${encodeURIComponent(JSON.stringify({entry:'a'.repeat(2500)}))}`;
 expect(()=>createDeviceTestScheme({scheme:issued,deploymentId:id,query:{source:'b'.repeat(2500)},allowedQueryKeys:['entry','source']})).toThrow('Test query exceeds size limit');
});
test('plans bind the artifact and leave every actual device check unverified',()=>{
 const artifact={appName:'demo',version:'1.3.0',commit:'a'.repeat(40),sha256:'b'.repeat(64),deploymentId:id};
 const report=createDeviceTestPlan({artifact,scheme,routes:[{name:'result',path:'/result'}]});
 expect(report.checks.every(c=>c.status==='not_run')).toBe(true);expect(report.checks).toHaveLength(2);
 expect(()=>createDeviceTestPlan({artifact:{...artifact,sha256:'changed'},scheme})).toThrow();
});
