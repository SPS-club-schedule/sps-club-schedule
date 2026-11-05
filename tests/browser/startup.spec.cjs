const {test,expect}=require('@playwright/test');

test('startup downloads scripts beside CSS and opens without version/config responses',async({page})=>{
  let releaseStyles;
  const stylesReady=new Promise(resolve=>{releaseStyles=resolve;}),requests=[],errors=[];
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(/\/(version|config)\.json$/.test(url.pathname))return; // Simulate a stalled connection.
    if(url.pathname.endsWith('.css'))await stylesReady;
    return route.continue();
  });
  const script=page.waitForRequest(request=>/\/assets\/app-[^/]+\.js$/.test(new URL(request.url()).pathname));
  const chunk=page.waitForRequest(request=>/\/assets\/chunk-[^/]+\.js$/.test(new URL(request.url()).pathname));
  try{
    await page.goto('./#/auth',{waitUntil:'commit'});
    await Promise.all([script,chunk]);
  }finally{releaseStyles();}
  await expect(page.locator('input[type="password"]')).toBeVisible();
  expect(requests.some(name=>name.endsWith('/config.json'))).toBe(false);
  expect(errors).toEqual([]);
});

for(const cache of ['legacy','missing-assets'])test(`cached ${cache} HTML recovers through the release manifest`,async({page},info)=>{
  test.skip(info.project.name==='app','Bundled Android has no remote HTML or release bootstrap.');
  let manifests=0;
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/'){
      const response=await route.fetch();let html=await response.text();
      if(cache==='legacy')html=html.replace(/<meta name="sps-release"[^>]*>\n?/,'').replace(/<link (?:rel="stylesheet"|rel="modulepreload")[^>]*>\n?/g,'');
      else html=html.replace(/\.\/assets\/app-[A-Z0-9]+\.js/gi,'./assets/app-OLD12345.js').replace(/\.\/assets\/app-[a-f0-9]+\.css/g,'./assets/app-deadbeef.css');
      return route.fulfill({response,body:html});
    }
    if(url.pathname==='/version.json')manifests++;
    return route.continue();
  });
  await page.goto('./#/auth');
  await expect(page.locator('input[type="password"]')).toBeVisible();
  expect(manifests).toBeGreaterThan(0);
});
