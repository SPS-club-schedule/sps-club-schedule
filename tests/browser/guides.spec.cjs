const {test,expect}=require('@playwright/test');
async function setup(page,{empty=false,canWrite=true,role='owner'}={}){
 const now=Date.now(),me={id:'member-guide',name:'测试同学',role,department:'academic',joinedAt:now,departmentTemplateGuide:{version:1,status:'skipped'}};
 const task={_id:'t_guide',title:'本地测试待办',description:'测试内容',participantIds:[me.id],creatorId:me.id,dueAt:now+14*86400000,mode:'individual',priority:'normal',completions:{},revision:1};
 const template={_id:'tpl-guide',name:'研讨班模板',title:'研讨班',category:'学术',description:'本地示例',creatorId:me.id,updatedBy:me.id,participantIds:[me.id],mode:'shared',priority:'normal',roles:[],steps:[],revision:1};
 const board={full:true,version:1,club:{id:'club-guide',name:'指南测试社团',inviteVersion:1},me,members:[me],tasks:empty?[]:[task],templates:empty?[]:[template]};
 const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({now})=>{
  sessionStorage.setItem('sps-web-session',JSON.stringify({token:'a'.repeat(64),expiresAt:now+3600000,user:{id:'account-guide',username:'guide_test',emailVerifiedAt:now}}));
  sessionStorage.setItem('sps-web-club:account-guide','club-guide');localStorage.setItem('sps-display-mode','full');
  for(const key of ['sps-member-guide-v2:','sps-department-template-guide-v1:'])localStorage.setItem(key+JSON.stringify(['account-guide','club-guide']),'skipped');
 },{now});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(!['http://127.0.0.1:4188','https://sps-schedule.folderrewind.top','https://sysu-phy-club-book.folderrewind.top'].includes(url.origin))return route.abort();
  const ok=data=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{ok:true,data}});
  if(url.pathname==='/api'){
   const {action,input}=request.postDataJSON();
   if(['bootstrap','sync'].includes(action))return ok(board);
   if(action==='accountSettings')return ok({account:{emailNotificationsEnabled:false}});
   if(action==='bookingStatus')return ok({});
   if(action==='dismissDepartmentTutorial')return ok({});
   writes.push(action);
   if(action==='complete'){const baseVersion=board.version++;task.completions=input.done?{[me.id]:Date.now()}:{};task.revision++;return ok({baseVersion,version:board.version,club:board.club,task});}
   return ok({});
  }
  if(url.pathname==='/api/activities')return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{from:'2026-11-05',to:'2027-01-05',activities:[]}});
  if(url.pathname.endsWith('/experience-index.json'))return route.fulfill({json:{entries:[]}});
  if(url.pathname==='/experience')return ok({canWrite,entries:empty?[]:[{id:'doc-guide',kind:'file',source:'web',path:'测试复盘.md',size:30,canEdit:canWrite,revision:1}]});
  if(url.pathname==='/experience/files/doc-guide')return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},contentType:'text/plain',body:'# 本地经验\n\n活动流程与复盘。\n\n$E=mc^2$'});
  if(url.pathname.startsWith('/experience/')){writes.push(url.pathname);return ok({});}
  return url.origin==='http://127.0.0.1:4188'?route.continue():route.abort();
 });
 await page.goto('./#/mine');await expect(page.locator('[data-tour="my-todos"]')).toBeVisible();
 return {writes,errors};
}
const guide=page=>page.locator('#member-guide');
async function checkSpotlight(page,id){
 await expect(guide(page)).toBeVisible();await expect(guide(page)).toHaveAttribute('data-guide-step',id);
 await expect(guide(page)).toHaveAttribute('data-guide-missing','false');
 const target=page.locator('[data-guide-target]');await expect(target).toHaveCount(1);
 await expect.poll(()=>page.evaluate(()=>{
  const a=document.querySelector('[data-guide-target]').getBoundingClientRect(),b=document.querySelector('.guide-outline').getBoundingClientRect(),c=document.querySelector('.guide-coach').getBoundingClientRect();
  const overlap=Math.max(0,Math.min(b.right,c.right)-Math.max(b.left,c.left))*Math.max(0,Math.min(b.bottom,c.bottom)-Math.max(b.top,c.top));
  return b.width>0&&b.height>0&&b.left<=a.left+9&&b.right>=Math.min(innerWidth,a.right)-9&&Math.min(b.bottom,a.bottom)-Math.max(b.top,a.top)>Math.min(20,a.height/2)&&overlap<2&&c.top>=-1&&c.bottom<=innerHeight+1;
 }),{message:'spotlight must point to a visible control without coach overlap: '+id}).toBe(true);
}
async function next(page){await page.locator('[data-guide="next"]').click();}
async function walk(page,{department=false,write=true,screenshots=false}={}){
 const seen=[];
 for(let i=0;i<60;i++){
  await expect(guide(page)).toBeVisible();const id=await guide(page).getAttribute('data-guide-step');
  if(seen.includes(id))throw Error('Guide failed to advance from '+id);seen.push(id);await checkSpotlight(page,id);
  if(id==='todos')await expect(page.locator('[data-guide-target]')).toHaveClass('todo-toggle');
  if(screenshots&&['todos','dept-dependency','experience-source'].includes(id))await page.screenshot({path:test.info().outputPath(id+'.png')});
  if(id==='title')await page.locator('[data-guide-target]').fill('研讨班练习');
  if(id==='child-title')await page.locator('[data-guide-target]').fill('预约教室');
  if(id==='child-people')await page.locator('[data-guide-target] [data-action="stepFollow"][data-value="main"]').click();
  if(id==='dept-backward')await page.locator('[data-guide-target]').click();
  if(id==='experience-source')await page.locator('[data-guide-target]').fill('# 交接记录\n\n$E=mc^2$');
  if(id==='experience-list'){if(await page.locator('[data-guide-target]').evaluate(el=>el.matches('a')))await page.locator('[data-guide-target]').click();else await next(page);}
  else if(['create','kind','add-child','experience-entry'].includes(id))await page.locator('[data-guide-target]').click();
  else if(id==='experience-contribute'&&write)await page.locator('[data-guide-target]').click();
  else {await next(page);if(id==='experience-save'||id==='experience-contribute')break;}
  await expect(guide(page)).not.toHaveAttribute('data-guide-step',id);
 }
 await expect(guide(page)).toBeHidden();return seen;
}
for(const department of [false,true])test((department?'administrator':'member')+' guide: every spotlight, interaction and transition',async({page})=>{
 const {writes,errors}=await setup(page,{role:department?'department_admin':'owner'});
 if(department){await page.goto('./#/templates');await page.getByRole('button',{name:'管理员指南',exact:true}).click();}
 else await page.locator('[data-action="tutorial"]:visible').first().click();
 const seen=await walk(page,{department,screenshots:true});
 expect(seen).toContain('experience-save');expect(seen).toContain(department?'dept-finish':'publish');expect(writes).toEqual([]);expect(errors).toEqual([]);
 // All teaching drafts are still local, including after Back through a real page.
 if(!department){await page.goto('./#/edit');await page.locator('#confirm [value="confirm"]').click();await expect(page.locator('#title')).toHaveValue('研讨班练习');}
});
test('empty lists and read-only experience never highlight an imaginary control or stall',async({page})=>{
 const {writes}=await setup(page,{empty:true,canWrite:false});await page.locator('[data-action="tutorial"]:visible').first().click();
 await checkSpotlight(page,'todos');await expect(guide(page)).toContainText('目前没有可操作');await next(page);await next(page);
 await page.locator('[data-guide="skip"]').click();
 await page.goto('./#/experience');await page.locator('[data-action="tutorial"]:visible').first().click();
 await checkSpotlight(page,'experience-search');await next(page);await checkSpotlight(page,'experience-list');await next(page);
 await checkSpotlight(page,'experience-contribute');await expect(guide(page)).toContainText('没有档案写入权限');await next(page);
 await expect(guide(page)).toBeHidden();expect(writes).toEqual([]);
});
test('Previous restores the child draft and a missing control leaves an exit',async({page})=>{
 await setup(page);await page.goto('./#/edit');await page.locator('[data-action="tutorial"]:visible').first().click();
 await page.locator('#title').fill('保留草稿');await next(page);await page.locator('[data-guide-target]').click();await next(page);await next(page);await next(page);
 await page.locator('[data-guide-target]').click();await page.locator('[data-guide-target]').fill('保留子任务');await next(page);
 await page.locator('[data-guide="previous"]').click();await checkSpotlight(page,'child-title');await expect(page.locator('[data-guide-target]')).toHaveValue('保留子任务');
 await page.locator('[data-guide-target]').evaluate(el=>el.closest('details').open=false);await page.setViewportSize({width:380,height:760});await checkSpotlight(page,'child-title');
 await page.locator('[data-guide-target]').evaluate(el=>el.remove());await page.locator('[data-guide="previous"]').click();await next(page);
 await expect(guide(page)).toHaveAttribute('data-guide-missing','true');await expect(page.locator('[data-guide="skip"]')).toBeVisible();await page.locator('[data-guide="skip"]').click();await expect(guide(page)).toBeHidden();
});

test('the highlighted completion checkbox is actually clickable and empty state stays navigable',async({page})=>{
 const {writes}=await setup(page);await page.locator('[data-action="tutorial"]:visible').first().click();
 await checkSpotlight(page,'todos');await page.locator('[data-guide-target]').click();
 await expect(page.locator('[data-guide-target]')).toHaveAttribute('data-tour','my-todos');await checkSpotlight(page,'todos');await next(page);await expect(guide(page)).toHaveAttribute('data-guide-step','todo-detail');expect(writes).toEqual(['complete']);
});
test('administrator guide also completes with an empty library and read-only archive',async({page})=>{
 const {writes,errors}=await setup(page,{empty:true,canWrite:false,role:'department_admin'});
 await page.goto('./#/templates');await page.locator('[data-action="departmentTutorial"]').click();
 await walk(page,{department:true,write:false});expect(writes).toEqual([]);expect(errors).toEqual([]);
});
test('keyboard-sized viewport keeps the text input inside the spotlight',async({page})=>{
 await setup(page);await page.goto('./#/edit');await page.locator('[data-action="tutorial"]:visible').first().click();
 await page.setViewportSize({width:390,height:420});await checkSpotlight(page,'title');
 const boxes=await page.evaluate(()=>{const a=document.querySelector('[data-guide-target]').getBoundingClientRect(),b=document.querySelector('.guide-outline').getBoundingClientRect();return {a:{top:a.top,bottom:a.bottom},b:{top:b.top,bottom:b.bottom}};});
 expect(boxes.b.top).toBeLessThanOrEqual(boxes.a.top);expect(boxes.b.bottom).toBeGreaterThanOrEqual(boxes.a.bottom);
 await page.locator('[data-guide-target]').fill('Keyboard test');await next(page);await checkSpotlight(page,'kind');
});

test('read-only documents explain download instead of an unavailable edit button',async({page})=>{
 const {writes}=await setup(page,{canWrite:false});await page.goto('./#/experience');await page.locator('[data-action="tutorial"]:visible').first().click();
 await checkSpotlight(page,'experience-search');await next(page);await page.locator('[data-guide-target]').click();
 await checkSpotlight(page,'experience-read');await next(page);await checkSpotlight(page,'experience-edit-entry');
 await expect(page.locator('[data-guide-target]')).toHaveAttribute('data-action','experienceDocumentDownload');await next(page);await checkSpotlight(page,'experience-contribute');await next(page);await expect(guide(page)).toBeHidden();expect(writes).toEqual([]);
});
