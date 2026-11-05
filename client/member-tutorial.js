import {resolveParticipants} from '../shared/assignments';

// Each instruction names the exact control in its spotlight. Empty states have
// their own explanation; they never pretend an unavailable control exists.
const emptyTodos={target:'[data-tour="my-todos"]',title:'目前没有可操作的待办',text:'有任务分配给你后，条目右侧会出现完成方框。现在先认识任务入口，再练习创建一项草稿。'};
export const experienceSteps=[
  {id:'experience-entry',page:'mine',target:'a[href="#/experience"]',title:'把任务经验留在经验档案',text:'点击高亮的「经验档案」。活动流程、复盘和交接文档放在这里，方便下一次查找和复用。',action:'a[href="#/experience"]'},
  {id:'experience-search',page:'experience',target:'input[name="experienceSearch"]',title:'搜索已有经验',text:'在这个搜索框输入文件名、目录或说明。搜索覆盖所有文件夹；清空后回到当前目录。',next:'找到阅读入口'},
  {id:'experience-list',page:'experience',target:'.experience-file-actions a[href*="document="]',title:'在线阅读这份文档',text:'点击高亮的「在线阅读」。Markdown、LaTeX 和纯文本可以在站内阅读；其他格式使用旁边的下载入口。',next:'打开文档',action:'.experience-file-actions a[href*="document="]',fallback:{target:'.experience-list',title:'当前目录没有可预览文档',text:'文件夹可逐层打开。继续时会尝试打开档案中的一份可读文档；如果档案为空，就直接介绍贡献入口。'}},
  {id:'experience-read',page:'experience',target:'[data-document-preview]',title:'阅读正文与公式',text:'高亮区域是文档正文，可以滚动阅读。Markdown 的标题、表格和公式会直接呈现；LaTeX 文件用于公式预览。',next:'了解修改入口'},
  {id:'experience-edit-entry',page:'experience',target:'[data-action="experienceDocumentEdit"], [data-action="experienceDocumentCopy"]',title:'继续完善已有资料',text:'高亮入口按文档权限显示「编辑正文」或「编辑并另存副本」。仓库文档另存为网页副本；可编辑的网页文档直接修改正文。本步只介绍入口，不会改动文档。',next:'了解上传入口',interactive:false,fallback:{target:'[data-action="experienceDocumentDownload"]',title:'无修改权限时，可以下载源码',text:'当前文档不提供修改入口。高亮的「下载源码」可以保存原始内容；之后可由有权限的成员整理更新。'}},
  {id:'experience-upload',page:'experience',target:'[data-action="experienceUploadForm"]',title:'已有文件从这里上传',text:'「上传资料」用于选择本机文件、指定目录并填写说明，提交后公开可读。本步只介绍入口，不打开文件选择器，也不会上传。',next:'了解文件夹',interactive:false,writeOnly:true},
  {id:'experience-folder',page:'experience',target:'[data-action="experienceFolderForm"]',title:'按届次、部门或主题整理',text:'「新建文件夹」可以建立多层目录，例如 2026届/学术部。已有资料的「整理」入口可修改路径、说明；按文件权限决定是否可操作。',next:'试写一份文档',interactive:false,writeOnly:true},
  {id:'experience-contribute',page:'experience',target:'[data-action="experienceDocumentNew"]',title:'在站内新建文档',text:'点击高亮的「新建文档」，练习写一份复盘或交接说明。也可以选择完成指南；指南不会替你保存或公开内容。',next:'完成指南',action:'[data-action="experienceDocumentNew"]',fallback:{target:'.experience-search-row input',title:'公开阅读与成员贡献',text:'当前账号没有档案写入权限，可以搜索、阅读和下载。拥有 SPS 成员权限后，这里会提供新建文档与上传入口。'}},
  {id:'experience-source',page:'experience',target:'#experienceDocumentSource',writeOnly:true,title:'在这个输入框写正文',text:'试写一个标题或公式，例如 # 活动复盘、$E=mc^2$。这里只修改本地草稿，下一步查看渲染效果。',next:'查看预览'},
  {id:'experience-preview',page:'experience',target:'[data-document-preview]',writeOnly:true,title:'检查正文与公式预览',text:'高亮区域随输入更新。可以用「上一步」回到正文继续修改；内容仍未公开。',next:'选择格式'},
  {id:'experience-format',page:'experience',target:'#experienceDocumentFormat',writeOnly:true,title:'选择文档格式',text:'在这个下拉框选择 Markdown、LaTeX 公式或纯文本。格式会同步到文件扩展名；使用适合内容的格式即可。',next:'设置文件路径'},
  {id:'experience-path',page:'experience',target:'#experienceDocumentPath',writeOnly:true,title:'写清存放目录与文件名',text:'在此填写路径，例如 2026届/学术部/研讨班复盘.md。请保留与格式一致的扩展名；目录让下一届更容易找到资料。',next:'认识保存按钮'},
  {id:'experience-save',page:'experience',target:'[data-tour="document-save"]',writeOnly:true,title:'最后检查，再保存并公开',text:'这是发布文档的实际按钮，指南期间不可提交。完成指南后，草稿保留在编辑器；检查内容和路径，再决定是否公开。刷新或关闭前请自行保存或下载源码。',next:'完成指南',interactive:false}
];
export const memberSteps=[
  {id:'todos',page:'mine',target:'.todo-toggle:not(:disabled)',title:'用右侧方框标记完成',text:'高亮的就是这项待办的完成方框。实际工作完成后点击它；协作任务由一位负责人完成即可。指南不会替你勾选，也可以直接继续。',next:'任务详情入口',fallback:emptyTodos},
  {id:'todo-detail',page:'mine',target:'.todo-main',title:'任务主体通向详情',text:'高亮的任务主体可打开说明、负责人、截止时间和子任务。完成方框是独立按钮；本步先认识入口，接下来练习创建任务。',next:'查看完成记录',interactive:false,fallback:emptyTodos},
  {id:'todo-done',page:'mine',target:'[data-action="filter"][data-value="done"]',title:'已完成的任务在这里',text:'点击「已完成」可以回看已经勾选的事项。需要恢复待办时，在对应条目撤销完成。',next:'练习创建任务'},
  {id:'create',page:'mine',target:'[data-tour="create-task"] a',title:'创建一项任务草稿',text:'点击高亮的「＋ 发布任务」打开编辑器。接下来只填写草稿，指南期间不会发布、分配或通知其他成员。',action:'a[href="#/edit"]'},
  {id:'title',page:'edit',target:'#title',title:'填写任务名称',text:'在这个输入框写清楚要做什么，例如「周六研讨班」。填写后继续；任务说明可以另行补充交付要求。',next:'区分截止与时段',ready:s=>!!s.form.title?.trim()},
  {id:'kind',page:'edit',target:'[data-action="duration"][data-value="true"]',title:'需要安排时段时，点这里',text:'默认的「仅截止时间」用于 DDL。点击高亮的「有持续时段」，为活动设置开始和结束时间。',action:'[data-action="duration"][data-value="true"]'},
  {id:'duration',page:'edit',target:'[data-tour="duration-range"]',title:'设置活动起止时间',text:'在这四个字段设置开始、结束日期和时间。只有带持续时段的主任务会同步到已连接的预约系统，子任务不会同步。',next:'确认截止时间'},
  {id:'deadline',page:'edit',target:'[data-tour="deadline"]',title:'确认独立的任务 DDL',text:'这两个字段是截止日期和时间，默认跟随活动开始。手动修改后，调整活动时段不会再覆盖 DDL。',next:'选择负责人'},
  {id:'people',page:'edit',target:'[data-tour="task-people"]',title:'选择本次参与成员',text:'点击高亮区域内的部门或姓名调整名单。逐人完成需要每人确认；协作完成由名单中任一人确认。发布后保留本次名单。',next:'添加准备步骤',ready:s=>resolveParticipants(s.form,s.editBoard?.members||[]).length>0},
  {id:'add-child',page:'edit',target:'[data-action="addStep"]',title:'把准备工作拆成子任务',text:'点击高亮的「＋ 添加一步」，增加一项准备工作，例如预约教室、制作海报或准备讲义。',action:'[data-action="addStep"]'},
  {id:'child-title',page:'edit',target:'[data-tour="child-title"] input',child:true,title:'命名这项子任务',text:'在此写具体工作，例如「预约教室」。主任务和子任务分别确认完成，完成全部子任务不会自动完成主任务。',next:'设置这一步的 DDL',ready:(s,i)=>!!s.steps[i]?.title?.trim()},
  {id:'child-deadline',page:'edit',target:'[data-tour="child-deadline"]',child:true,title:'设置这一步的截止时间',text:'在这里设置比主任务提前几天，或点「单独调整日期 / 时间」。这组草稿字段用于 DDL；已发布的子任务还可单独编辑持续时段。',next:'分配这一步的负责人'},
  {id:'child-people',page:'edit',target:'[data-tour="child-people"]',child:true,title:'给子任务分配负责人',text:'可以单独选人、跟随主任务名单，或按已定义角色分配。发布后，这一步会出现在负责人的待办与日历中。',next:'检查发布入口',ready:(s,i)=>!!s.steps[i]&&resolveParticipants(s.steps[i],s.editBoard?.members||[],s.form).length>0},
  {id:'publish',page:'edit',target:'.editor-pane [form="task-form"], .footer [form="task-form"]',title:'核对后再发布任务',text:'这是实际发布按钮，指南期间不可提交。下一步介绍经验档案，当前草稿会暂存；完成指南后返回「发布任务」可继续检查并自行发布。刷新或关闭页面会丢失未提交草稿。',next:'进入经验档案',interactive:false},
  ...experienceSteps
];
