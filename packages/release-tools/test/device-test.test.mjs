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
 for(const patch of [{deploymentId:'changed'},{scheme:scheme+'&_deploymentId='+id},{scheme:'intoss://app'},{path:'//other'},{path:'/%2e%2e/private'},{query:{accessToken:'secret'},allowedQueryKeys:['accessToken']}])
  expect(()=>createDeviceTestScheme({scheme,deploymentId:id,...patch})).toThrow();
});
test('plans bind the artifact and leave every actual device check unverified',()=>{
 const artifact={appName:'demo',version:'1.3.0',commit:'a'.repeat(40),sha256:'b'.repeat(64),deploymentId:id};
 const report=createDeviceTestPlan({artifact,scheme,routes:[{name:'result',path:'/result'}]});
 expect(report.checks.every(c=>c.status==='not_run')).toBe(true);expect(report.checks).toHaveLength(2);
 expect(()=>createDeviceTestPlan({artifact:{...artifact,sha256:'changed'},scheme})).toThrow();
});
