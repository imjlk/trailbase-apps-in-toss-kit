import { expect, test } from 'bun:test';
import { appsInTossWebOrigins, createWebViewNetworkCheck } from '../src/webview-network-check.mjs';
import { createReleaseDoctorChecksFromConfig, runReleaseDoctor } from '../src/release-doctor.mjs';

test('SDK origin cutover is bounded and unknown versions require explicit observed origins', () => {
  expect(appsInTossWebOrigins({ appName:'demo', sdkVersion:'3.1.0' })[0]).toBe('https://demo.web.tossmini.com');
  for (const sdkVersion of ['2.10.11','3.1.1','3.7.0']) expect(appsInTossWebOrigins({ appName:'demo',sdkVersion })[1]).toBe('https://demo.private-apps.tossmini.com');
  for (const sdkVersion of ['4.0.0','3.1.1-rc.1','latest']) expect(()=>appsInTossWebOrigins({ appName:'demo',sdkVersion })).toThrow();
});
const options = { endpoint:'https://api.example.test/api', appName:'demo', sdkVersion:'3.7.0' };
test('probes both origins with OPTIONS only and distinguishes missing headers and redirects', async () => {
  const calls=[];
  const fetcher=async (url,init) => { calls.push(init); return new Response(null,{status:204,headers:{
    'Access-Control-Allow-Origin':init.headers.Origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type'
  }}); };
  expect((await createWebViewNetworkCheck({...options,fetcher}).run()).ok).toBe(true);
  expect(calls).toHaveLength(2); expect(calls.every(i=>i.method==='OPTIONS' && i.redirect==='manual' && i.credentials==='omit' && !i.headers.Authorization)).toBe(true);
  for (const response of [new Response(null,{status:302,headers:{location:'https://other.test'}}),new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*'}})]) {
    expect((await createWebViewNetworkCheck({...options,fetcher:async()=>response}).run()).ok).toBe(false);
  }
});
test('malformed configuration, RN skip and stalled transport do not contact unrelated services', async () => {
  let calls=0; const fetcher=async()=>{calls++;throw Error('token-secret')};
  expect((await createWebViewNetworkCheck({...options,runtime:'rn',fetcher}).run()).skipped).toBe(true);
  expect((await createWebViewNetworkCheck({...options,endpoint:'https://user:secret@host',fetcher}).run()).ok).toBe(false);
  expect(calls).toBe(0);
  const result=await createWebViewNetworkCheck({...options,timeout:5,fetcher:()=>new Promise(()=>{})}).run();
  expect(result.failures.every(v=>v.endsWith('timeout'))).toBe(true);
  const fail=await createWebViewNetworkCheck({...options,fetcher}).run();
  expect(JSON.stringify(fail)).not.toContain('token-secret');
});
test('safelisted methods do not require an allow-methods echo but unsafe methods do', async () => {
  const check = async (method, allowedMethod) => createWebViewNetworkCheck({...options, method, fetcher:async (_,init)=>new Response(null,{status:204,headers:{
    'Access-Control-Allow-Origin':init.headers.Origin,
    'Access-Control-Allow-Headers':'Authorization, Content-Type',
    ...(allowedMethod ? {'Access-Control-Allow-Methods':allowedMethod} : {}),
  }})}).run();
  for (const method of ['GET','HEAD','POST']) {
    expect((await check(method)).ok).toBe(true);
    expect((await check(method,'PATCH')).ok).toBe(true);
  }
  for (const method of ['PUT','PATCH','DELETE']) {
    expect((await check(method)).ok).toBe(false);
    expect((await check(method,'POST')).ok).toBe(false);
    expect((await check(method,method)).ok).toBe(true);
  }
});
test('safelisted methods still require exact origin, requested headers and successful status', async () => {
  const baseHeaders = {'Access-Control-Allow-Origin':appsInTossWebOrigins(options)[0],'Access-Control-Allow-Headers':'Authorization, Content-Type'};
  for (const patch of [{status:403},{headers:{...baseHeaders,'Access-Control-Allow-Origin':'*'}},{headers:{...baseHeaders,'Access-Control-Allow-Headers':'Content-Type'}}]) {
    const result=await createWebViewNetworkCheck({...options,origins:[baseHeaders['Access-Control-Allow-Origin']],fetcher:async()=>new Response(null,{status:204,headers:baseHeaders,...patch})}).run();
    expect(result.ok).toBe(false);
  }
});
test('Release Doctor accepts the new opt-in check without changing existing configuration', async () => {
  const checks=createReleaseDoctorChecksFromConfig({checks:[{type:'webview-network',runtime:'rn'}]});
  const result=await runReleaseDoctor({checks}); expect(result.skipped).toBe(1);
});
