const {parts}=require('./view');
const {templateDurationForm,templateDurationValue}=require('./template-duration');
const {scheduleDraft,applyTemplateDuration}=require('./schedule-draft');
const VERSION=1;
const departmentTutorialKey=(accountId,clubId)=>accountId&&clubId?'sps-department-template-guide-v'+VERSION+':'+JSON.stringify([accountId,clubId]):'';
function canOfferDepartmentTutorial(s,accountId) {
  const board=s.sync?.board;
  return !!accountId && ['board','mine','calendar','templates'].includes(s.page) && s.sync?.phase==='ready' &&
    !!board?.club?.id && board.me?.role==='department_admin' && board.me.departmentTemplateGuide?.version!==VERSION &&
    !s.busy && !s.error && !s.recovery;
}
// These are local teaching drafts, never shared templates or publishable tasks.
function departmentPracticeTemplate() {
  const step=(id,title,daysBefore,estimateDays,roleId,dependsOn=[],anchorToMain=false)=>({id,title,daysBefore,estimateDays,roleId,dependsOn,anchorToMain,description:'',mode:'shared',priority:'normal',participantIds:[],participantDepartment:'',followMain:false,customDeadline:false});
  return {
    form:{name:'研讨班 · 教程练习',category:'学术活动',title:'研讨班',description:'练习安排宣传准备工作',mode:'shared',priority:'normal',participantIds:[],participantDepartment:'',schedulingMode:'independent',...templateDurationForm(120),roles:[{id:'publicity',name:'宣传负责人',participantIds:[]},{id:'poster',name:'海报制作人',participantIds:[]}]},
    steps:[step('copy','撰写宣传文案',3,3,'publicity'),step('poster','制作海报',2,1,'poster',['copy']),step('announce','发布宣传',1,1,'publicity',['poster'],true)],openSteps:new Set([0])
  };
}
function departmentPracticeTask(template,members,now=Date.now()) {
  const draft=structuredClone(template),p=parts(now+14*86400000);
  draft.form={...draft.form,...scheduleDraft(null),date:p.date,time:'19:00',participantIds:draft.form.participantDepartment||draft.form.participantIds.length?draft.form.participantIds:members.map(m=>m.id)};
  let duration=null;try{duration=templateDurationValue(template.form);}catch{}
  applyTemplateDuration(draft.form,duration);
  draft.appliedTemplate={name:template.form.name};
  draft.openSteps=new Set([0]);return draft;
}
function departmentPracticeDrafts() {
  const drafts=new Map();
  return {
    capture(s,key) {
      if(!key||!s.guidePractice||!s.editBoard)return;
      const entry=drafts.get(key)||{};
      const previous=entry[s.page];
      entry[s.page]=structuredClone({form:s.form,steps:s.steps,openSteps:s.openSteps,appliedTemplate:s.appliedTemplate});drafts.set(key,entry);
      // Going Back preserves chosen people unless the example itself changed.
      if(s.page==='template-edit'&&JSON.stringify([previous?.form,previous?.steps])!==JSON.stringify([s.form,s.steps]))delete entry.edit;
    },
    restore(page,key,members) {
      const entry=drafts.get(key)||{};
      entry['template-edit'] ||= departmentPracticeTemplate();
      if(page==='edit')entry.edit ||= departmentPracticeTask(entry['template-edit'],members);
      drafts.set(key,entry);return structuredClone(entry[page]);
    },
    clear(key){drafts.delete(key);}
  };
}
module.exports={VERSION,departmentTutorialKey,canOfferDepartmentTutorial,departmentPracticeTemplate,departmentPracticeTask,departmentPracticeDrafts};
