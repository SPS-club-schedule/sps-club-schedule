// The same spotlight/coach as the member guide, on explicitly local examples.
const library=(id,target,title,text,next='继续',interactive=false)=>({id:'dept-'+id,page:'templates',target,title,text,next,interactive});
const edit=(id,target,title,text,extra={})=>({id:'dept-'+id,page:'template-edit',target,title,text,next:'继续',interactive:true,...extra});
const task=(id,target,title,text,extra={})=>({...edit(id,target,title,text,extra),page:'edit'});
export const departmentSteps=[
  library('welcome','[data-tour="template-library"]','部门管理员，欢迎使用模板工作区','这是独立于成员指南的模板教程。接下来会用「研讨班」本地示例练习，覆盖创建、分工、依赖、倒排与套用。可随时跳过；以后从模板库的「模板设置教程」重看。'),
  library('search','.search-box','先找现有模板','模板由全社团共享，每位成员都可以创建、编辑和分类。先搜索名称、分类或说明，再用下方分类筛选，避免重复创建。','继续',true),
  library('reuse','[data-tour="template-list"]','使用、编辑、复制与归档','「使用模板」生成本次任务草稿；「编辑 / 分类」修改共享版本；「复制」另建一个版本。归档仅限模板创建者或社团创建者，已发布任务不受影响。这里先只看入口。','进入本地练习'),
  edit('name','#name','模板名称与主任务名称','模板名称供大家在模板库查找；主任务默认名称用于每次活动。示例中的「研讨班 · 教程练习」不会保存到共享库，你可以放心修改。'),
  edit('category','#category','用分类组织部门经验','可选择已有分类，也可直接输入新分类，例如「学术活动」。分类用于检索，不限制谁能使用或编辑这个模板。'),
  edit('main','[data-tour="template-main"]','写清主任务的默认内容','默认名称可以在套用时改成「第六期研讨班」。说明适合记录目标、流程、交付要求与注意事项，让下一位负责人能接手。'),
  edit('duration','[data-tour="template-duration"]','活动时长与截止时间分别设置','「仅截止时间」用于待办；「默认持续时长」用于活动。这里预设 2 小时，套用时选开始时间就会计算结束时间。活动时长不是准备工作的保守耗时。'),
  edit('completion','[data-tour="template-completion"]','逐人完成、协作完成和优先级','逐人完成要求每位参与者分别勾选；协作完成由指定成员中任意一人完成即可。优先级用于突出事项，不会改变日期算法；每个子任务也能单独设置。'),
  edit('people','[data-tour="template-people"]','默认成员与部门名单','可固定选人，或按部门自动选人。部门名单在使用、发布时按最新成员解析；发布后保留当次名单。未选部门且主任务名单留空，套用时默认选择全体成员。'),
  edit('roles','.template-roles','先定义角色，再在使用时选人','角色是这次工作的分工名称，不是账号权限。例如「宣传负责人」同时负责文案与宣传，「海报制作人」负责海报。可添加、改名或移除角色；移除后关联步骤改为单独指定。'),
  edit('steps','[data-tour="step-list-heading"]','把准备工作拆成独立步骤','示例有文案、海报、宣传三步。下方「添加一步」最多添加 20 步；展开每步可写名称和说明、设置完成方式与优先级、上下移动或移除。显示顺序不决定依赖。'),
  edit('assignment','[data-tour="child-people"]','每一步有三种分配方式','「单独指定」选具体人或部门；「跟随主任务负责人」沿用主任务名单；「按角色分配」关联上面的角色。这里文案与宣传关联同一角色，使用时只需选人一次。',{childIndex:0}),
  edit('dependency','.dependency-picker','海报依赖文案，但不会锁住完成按钮','在海报这一步选择「撰写宣传文案」，表示准备顺序。可以依赖多个子任务，系统会阻止循环依赖。无论前置任务是否完成，仍可以直接完成海报任务。',{childIndex:1}),
  edit('independent','.planning-selector','第一种截止方式：各步提前几天','「按各步提前天数」分别设置相对主任务截止时间的天数，例如文案提前 3 天、海报 2 天、宣传 1 天。此模式中的依赖只用于展示。'),
  edit('backward','.planning-selector','第二种截止方式：按依赖与耗时倒排','点击「按依赖与耗时倒排」再继续。系统从主任务截止和各步的提前要求向前推算；同一任务受到多个后续约束时，取更早的时间。',{ready:s=>s.form.schedulingMode==='backward'}),
  edit('estimate','[data-tour="child-deadline"]','填写保守预计耗时','文案预计 3 天、海报 1 天、宣传 1 天。按自然日计算，1 天为 24 小时；可填小数，0 可表示里程碑。这里填写的是留给工作的时间，不是提前主任务的天数。',{childIndex:0}),
  edit('anchor','[data-tour="child-deadline"]','把「宣传至少提前 1 天」设为约束','宣传这一步选「至少提前主任务」，填写 1 天；其他步骤可选「按依赖倒排」。链条中间也能加提前要求，算法会同时满足它和后续工作的时间要求。',{childIndex:2}),
  edit('preview','.planning-preview','读懂最晚开始与截止时间','原示例中：宣传在主任务前 1 天截止、前 2 天开始；海报前 2 天截止；文案前 3 天截止、前 6 天开始。若多条路径汇合，采用要求更早的截止；独立分支可并行。你修改后，以这里的实时预览为准。'),
  edit('save','.editor-pane [form="template-form"], .footer [form="template-form"]','检查后保存共享模板','正常编辑时，保存会让全社团看到这个版本；不会修改已发布的任务。名称、角色、耗时、依赖等有问题时会提示修正。练习无法提交，下一步模拟使用当前示例。',{next:'练习套用模板',interactive:false}),
  task('apply','.template-picker','使用模板后，是本次任务草稿','正常使用时，从模板卡片点击「使用模板」，或在发布任务页选择模板后「套用」。标题、说明、分工和步骤都会带入；本次修改不会回写共享模板。这里仍是本地练习。',{interactive:false}),
  task('date','[data-tour="deadline"]','先确定主任务截止时间','主任务截止是所有提前天数和倒排的基准。活动的截止默认跟随开始时间；手动修改后则独立。调整主任务日期、依赖或耗时，会重算尚未发布的子任务。'),
  task('roles','.template-roles','每个角色选一次负责人','选择成员或部门，关联这个角色的所有子任务会一起分配。同一人可以兼任，角色也可选多人。要只改某一步，可将它切换为「单独指定」；发布前所有使用到的角色都需要选人。'),
  task('dates','[data-tour="child-deadline"]','本次还可以加更具体的最晚日期','倒排模式中的「为本次设置最晚完成日期」替代这一步的提前天数约束，依赖仍可能要求更早完成。预览出现来不及从现在开始的提示时，应调迟主任务或调整计划后再发布。',{childIndex:0}),
  task('finish','.editor-pane [form="task-form"], .footer [form="task-form"]','最后核对，再发布正式任务','正常发布会生成主任务和各个子任务，负责人可在待办与日历中看到；依赖关系始终不限制完成顺序。发布后截止日期固定，后续修改模板或主任务不会自动重排子任务。本次练习没有保存、发布或通知任何人。',{next:'完成教程，返回模板库',interactive:false})
];
