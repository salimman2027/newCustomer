// =====================================================================
// NQ-ERP Partner Portal — app logic (Supabase backend)
// =====================================================================
const STATUS = {
  pending:     { t:'قيد الاعتماد (خلال 24 ساعة)', c:'bg-teal-50 text-[#0e8388] border-teal-200' },
  escalated:   { t:'مرفوع لمدير المبيعات (>30 يوم)', c:'bg-purple-50 text-purple-800 border-purple-200' },
  approved:    { t:'معتمد — مُسند للمبيعات المباشرة', c:'bg-sky-50 text-sky-800 border-sky-200' },
  negotiation: { t:'تحت التفاوض (Direct Sales)', c:'bg-amber-50 text-amber-800 border-amber-200' },
  closed:      { t:'تم التعاقد', c:'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rejected:    { t:'مرفوض / غير مؤهل', c:'bg-red-50 text-red-800 border-red-200' }
};
const KIT = [
  { tag:'ملف شامل', title:'البروفايل التعريفي لنظام NQ-ERP', file:'NQ-ERP-Company-Profile.txt', text:'شركة الجودة الوطنية لتقنية المعلومات (National Quality - www.nqs.sa)\nالملف التعريفي لنظام NQ-ERP للمنشآت المتوسطة (30 إلى 200 موظف)\n- الربط الإلكتروني الفوري مع هيئة الزكاة والضريبة والجمارك (فاتورة)\n- محاسبة مالية متكاملة ومراكز تكلفة\n- إدارة المخازن والمشتريات والمبيعات والموارد البشرية' },
  { tag:'القطاع الصناعي', title:'عرض المصانع والخرسانة و SIRI', file:'NQ-ERP-Industrial-SIRI.txt', text:'حلول NQ-ERP للقطاع الصناعي ومصانع الخرسانة والأغذية وتقييم SIRI\n- شجرة المواد (BOM) وأوامر التشغيل ومراقبة الهالك\n- ربط خطوط الإنتاج بالمخازن والحسابات لرفع درجة المصنع الذكي (SIRI)\nwww.nqs.sa' },
  { tag:'المقاولات العامة', title:'عرض إدارة المقاولات والمستخلصات', file:'NQ-ERP-Contracting.txt', text:'حلول NQ-ERP لقطاع المقاولات العامة (www.nqs.sa)\n- إدارة العقود والمستخلصات ومقاولي الباطن\n- متابعة خطابات الضمان البنكية ومراكز التكلفة لكل مشروع' },
  { tag:'النقليات والأساطيل', title:'عرض إدارة النقليات واللوجستيات', file:'NQ-ERP-Logistics.txt', text:'حلول NQ-ERP لقطاع النقليات وإدارة الأساطيل (www.nqs.sa)\n- إدارة أوامر الإركاب وبوليصات الشحن\n- ضبط مصروفات الديزل والصيانة الوقائية وربحية كل شاحنة' },
  { tag:'فيديو', title:'جولة داخل نظام NQ-ERP', file:'NQ-ERP-Video-Tour.txt', text:'جولة سريعة داخل نظام NQ-ERP: المحاسبة، المخازن، التصنيع، ولوحات تقارير الإدارة العليا باللغة العربية.\nللمشاهدة: https://www.youtube.com/@nqs_sa' },
  { tag:'فيديو', title:'الربط مع منصة فاتورة (ZATCA Phase 2)', file:'NQ-ERP-ZATCA.txt', text:'كيفية إصدار واعتماد الفواتير الإلكترونية لحظياً من داخل NQ-ERP دون أخطاء ضريبية.\nللمشاهدة: https://www.youtube.com/@nqs_sa' }
];

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtSAR = n => Math.round(Number(n)||0).toLocaleString('en-US') + ' ر.س';
const todayISO = () => { const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const dateOnly = v => v ? String(v).slice(0,10) : '';
const daysSince = iso => iso ? Math.floor((new Date(todayISO()+'T12:00:00') - new Date(dateOnly(iso)+'T12:00:00'))/86400000) : null;
const normPhone = p => { let d=String(p||'').replace(/\D/g,''); if(d.startsWith('00966')) d=d.slice(5); else if(d.startsWith('966')) d=d.slice(3); return d.replace(/^0+/,''); };
const maskIban = s => { s=String(s||'').replace(/\s/g,''); if(!s) return 'يُستكمل عند استحقاق أول عمولة'; if(s.length<10) return s; return s.slice(0,4)+' •••• •••• '+s.slice(-4); };
const quarterOf = iso => { const d=new Date(dateOnly(iso)+'T12:00:00'); return d.getFullYear()+'-Q'+(Math.floor(d.getMonth()/3)+1); };
function ladder(n){
  if(n<=2) return {pct:5,bonus:0,label:'5% — شريك معتمد (Certified)'};
  if(n===3) return {pct:7,bonus:0,label:'7% + ترقية لشريك استراتيجي + إعلان رسمي'};
  if(n<=5) return {pct:8,bonus:0,label:'8% — شريك استراتيجي (Strategic)'};
  if(n===6) return {pct:10,bonus:0,label:'10% — تثبيت النسبة القصوى'};
  return {pct:10,bonus:5000,label:'10% + مكافأة فورية 5,000 ر.س'};
}
function showToast(msg,type='info'){
  const el=document.createElement('div');
  const color=type==='success'?'bg-[#134e4a] border-[#14b8a6]':type==='error'?'bg-red-900 border-red-400':'bg-[#0f172a] border-[#0e8388]';
  el.className=`${color} text-white border-r-4 px-4 py-3 rounded-2xl shadow-xl text-xs font-extrabold animate-screen`;
  el.textContent=msg; $('toastContainer').appendChild(el);
  setTimeout(()=>{el.style.transition='opacity .25s';el.style.opacity='0';setTimeout(()=>el.remove(),260)},3800);
}
async function copyText(t){
  try{ await navigator.clipboard.writeText(t); showToast('تم النسخ إلى الحافظة','success'); }
  catch(e){ const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); showToast('تم النسخ إلى الحافظة','success'); }catch(_){ showToast('حدّد النص وانسخه يدوياً','error'); } ta.remove(); }
}
function downloadText(name,text){
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function busy(btn,on){ if(!btn) return; btn.disabled=on; btn.style.opacity=on?'.6':''; }
function errMsg(e){
  const m=(e&&(e.message||e.error_description))||'';
  if(m.includes('INVALID_LOGIN')) return 'البريد أو كلمة المرور غير صحيحة';
  if(m.includes('EMAIL_EXISTS')) return 'هذا البريد مسجّل مسبقاً — سجّل الدخول';
  if(m.includes('WEAK_PASSWORD')) return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
  if(m.includes('INVALID_EMAIL')) return 'البريد الإلكتروني غير صحيح';
  if(m.includes('TOO_MANY')) return 'محاولات كثيرة، انتظر 15 دقيقة';
  if(m.includes('UNAUTHORIZED')) return 'انتهت الجلسة، سجّل الدخول مجدداً';
  if(m.includes('SERVER_ERROR')) return 'خطأ في الخادم، حاول لاحقاً';
  if(m.includes('BLOCKED')) return 'لا يمكن تسجيل هذا الرقم — راجع نتيجة الفحص';
  if(m.includes('NOT_ADMIN')) return 'هذه العملية للإدارة فقط';
  return m || 'حدث خطأ، حاول مجدداً';
}

// ---------- state ----------
let me=null, uid=null, isAdmin=false;
let myPartner=null, myLeads=[], myPayouts=[];
let A={partners:[],leads:[],payouts:[],phones:[]};
let currentView='loading', currentTab='dashboard', adminTab='leads', leadFilter='open', payFilter='scheduled', lastCheck=null;

async function api(path, method='GET', body){
  const r=await fetch('/api'+path,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  let data={}; try{ data=await r.json(); }catch(e){}
  if(!r.ok){ const e=new Error(data.error||('HTTP '+r.status)); e.status=r.status; throw e; }
  return data;
}

function showScreen(name){
  currentView=name;
  ['loadingScreen','noDbScreen','registerScreen','portalApp','adminApp'].forEach(s=>$(s).classList.add('hidden'));
  $({loading:'loadingScreen',nodb:'noDbScreen',auth:'registerScreen',portal:'portalApp',admin:'adminApp'}[name]).classList.remove('hidden');
  window.scrollTo(0,0);
}

// ---------- init ----------
(async function init(){
  updateCalc(); renderKit(); $('leadDateLbl').textContent=todayISO();
  try{ await afterLogin(); }
  catch(e){ if(e.status===401) showScreen('auth'); else showScreen('nodb'); }
})();

async function afterLogin(){
  showScreen('loading');
  await loadMine();
  isAdmin=!!me.is_admin;
  $('hdrAdminBtn').classList.toggle('hidden',!isAdmin);
  if(isAdmin) return showAdmin();
  if(myPartner){ showScreen('portal'); switchTab('dashboard'); renderPortal(); }
  else { showScreen('auth'); switchAuthTab('register'); $('regEmail').value=me.email; notice('أكمل بيانات الانضمام لتفعيل حسابك.','info'); }
}
async function loadMine(){
  const d=await api('/me');
  me=d.user; uid=me.id; myPartner=d.partner; myLeads=d.leads||[]; myPayouts=d.payouts||[];
}

// ---------- auth ----------
function switchAuthTab(t){
  $('loginForm').classList.toggle('hidden',t!=='login'); $('registerForm').classList.toggle('hidden',t!=='register');
  $('tabBtnLogin').className='py-2.5 rounded-xl text-sm '+(t==='login'?'font-black bg-[#0f172a] text-white':'font-extrabold text-slate-600');
  $('tabBtnRegister').className='py-2.5 rounded-xl text-sm '+(t==='register'?'font-black bg-[#0e8388] text-white':'font-extrabold text-slate-600');
  $('authNotice').classList.add('hidden');
}
function notice(msg,type){
  const n=$('authNotice'); n.classList.remove('hidden');
  n.className='m-5 mt-0 rounded-xl p-3 text-xs font-bold border '+(type==='error'?'bg-red-50 border-red-200 text-red-900':'bg-teal-50 border-teal-200 text-teal-950');
  n.textContent=msg;
}
function toggleRegType(){
  $('regTypeGroup').querySelectorAll('label').forEach(l=>{
    l.className = l.querySelector('input').checked
      ? 'cursor-pointer border-2 border-[#0e8388] bg-teal-50/60 rounded-xl p-2.5 text-center text-xs font-black'
      : 'cursor-pointer border border-slate-200 bg-slate-50 rounded-xl p-2.5 text-center text-xs font-extrabold text-slate-600';
  });
}
async function handleLogin(e){
  e.preventDefault(); const b=$('btnLogin'); busy(b,true);
  try{ await api('/login','POST',{email:$('loginEmail').value.trim(),password:$('loginPass').value}); await afterLogin(); }
  catch(err){ notice(errMsg(err),'error'); }
  busy(b,false);
}
async function handleRegister(e){
  e.preventDefault(); const b=$('btnRegister'); busy(b,true);
  const body={ name:$('regName').value.trim(), email:$('regEmail').value.trim(), password:$('regPass').value,
    phone:$('regPhone').value.trim(), iban:$('regIban').value.trim(), type:document.querySelector('input[name=regType]:checked').value };
  try{
    if(me) await api('/me/partner','POST',body); else await api('/register','POST',body);
    await afterLogin(); showToast('تم إنشاء حسابك بنجاح! أهلاً بك في شبكة الشركاء','success');
  }catch(err){ notice(errMsg(err),'error'); }
  busy(b,false);
}
function openChangePassword(){
  openModal('تغيير كلمة المرور',`<div><label class="lbl">كلمة المرور الحالية</label><input name="cur" type="password" required dir="ltr" class="inp"></div>
    <div><label class="lbl">كلمة المرور الجديدة (6 أحرف على الأقل)</label><input name="nx" type="password" minlength="6" required dir="ltr" class="inp"></div>
    <button type="submit" class="w-full bg-[#0e8388] text-white font-black py-3 rounded-xl text-sm">حفظ</button>`,
    async f=>{ await api('/me/password','POST',{current:f.cur.value,next:f.nx.value}); showToast('تم تغيير كلمة المرور','success'); });
}
async function logout(){ try{ await api('/logout','POST'); }catch(e){} me=null; myPartner=null; showScreen('auth'); switchAuthTab('login'); }

// ---------- partner stats ----------
function partnerStats(p, leads, payouts){
  const closedL=leads.filter(l=>l.status==='closed');
  const earned=closedL.reduce((s,l)=>s+(+l.commission||0),0);
  const paid=payouts.filter(x=>x.status==='paid').reduce((s,x)=>s+(+x.amount||0),0);
  const q=quarterOf(todayISO());
  const quarter=leads.filter(l=>quarterOf(l.submitted_at)===q && l.status!=='rejected').length;
  const rejected=leads.filter(l=>l.status==='rejected').length;
  const closed=closedL.length;
  return { leads, closed, earned, paid, pending:Math.max(0,earned-paid), quarter, q, rejected, payouts,
    tier: closed>=3?'شريك استراتيجي':'شريك معتمد', strategic: closed>=3, idle: daysSince(p.last_submit_at||p.created_at) };
}

// ---------- partner render ----------
function renderPortal(){
  const p=myPartner; if(!p) return;
  const st=partnerStats(p,myLeads,myPayouts);
  $('hdrName').textContent=p.name; $('hdrTier').textContent=st.tier.replace('شريك ',''); $('hdrEmail').textContent=p.email;
  const pct=Math.min(100,Math.round(st.quarter/6*100));
  $('kpiQuarterLabel').textContent=`إنجاز الربع الحالي (${st.q.split('-')[1]} ${st.q.split('-')[0]})`;
  $('kpiQuarterCount').textContent=st.quarter; $('kpiQuarterBar').style.width=pct+'%'; $('kpiQuarterPct').textContent=pct+'%';
  $('kpiQuarterHint').textContent = st.quarter>=6?'رائع! حققت التارجت الربع سنوي الكامل (6 / 6)':st.quarter===5?'بلغت الحد المقبول (5/6) — متبقي عميل واحد للتارجت':`متبقي ${5-st.quarter} للحد المقبول (5) و ${6-st.quarter} للتارجت الكامل (6)`;
  const idle=st.idle??0, box=$('kpiActivityBox');
  if(idle<60){ box.className='rounded-xl p-3 flex items-center justify-between gap-2 text-xs border bg-emerald-50 border-emerald-200';
    box.innerHTML=`<div class="flex items-center gap-2 text-emerald-900 font-extrabold"><span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>حساب نشط — آخر إدخال منذ ${idle} يوم</div><span class="text-[10px] font-bold text-emerald-700">أمان ضد إيقاف 90 يوم</span>`; }
  else if(idle<90){ box.className='rounded-xl p-3 flex items-center justify-between gap-2 text-xs border bg-amber-50 border-amber-200';
    box.innerHTML=`<div class="text-amber-900 font-extrabold"><i class="fa-solid fa-triangle-exclamation ml-1"></i>تنبيه: آخر إدخال منذ ${idle} يوم</div><span class="text-[10px] font-bold text-amber-700">متبقي ${90-idle} يوم قبل الإيقاف</span>`; }
  else { box.className='rounded-xl p-3 flex items-center justify-between gap-2 text-xs border bg-red-50 border-red-200';
    box.innerHTML=`<div class="text-red-900 font-extrabold"><i class="fa-solid fa-circle-pause ml-1"></i>الحساب معرّض للإيقاف — لا نشاط منذ ${idle} يوم</div><span class="text-[10px] font-bold text-red-700">سجّل عميلاً لإعادة التنشيط</span>`; }

  const c=st.closed; $('kpiClosed').textContent=c; $('kpiNextRate').textContent=`القادمة ${ladder(c+1).pct}%`;
  if(c<3){ const r=3-c;
    $('kpiUpgradeHint').innerHTML=`متبقي <strong>${r} صفقة</strong> لترقيتك لـ <strong>شريك استراتيجي</strong>`;
    $('spotTag').textContent=`متبقي ${r} صفقة (الصفقة #3)`; $('spotTitle').textContent='ترقّى إلى «شريك استراتيجي» واحصل على إعلان رسمي باسمك!';
    $('profSpot').className='rounded-xl p-3 text-xs font-bold flex items-start gap-2.5 border bg-amber-50 border-amber-200 text-amber-950';
    $('profSpot').innerHTML=`<i class="fa-solid fa-bullhorn text-amber-600 text-base mt-0.5"></i><div><strong>حالة النشر الدعائي:</strong> متبقي إغلاق <strong>${r} صفقة</strong> لترقيتك إلى «شريك استراتيجي» ونشر إعلانك الرسمي على www.nqs.sa.</div>`;
  } else {
    $('kpiUpgradeHint').innerHTML='مفعّل: <strong>شريك استراتيجي</strong> (نشر دعائي نشط)';
    $('spotTag').textContent='مفعّل بالكامل'; $('spotTitle').textContent='تم اعتمادك «شريكاً استراتيجياً» ونشر إعلانك الرسمي!';
    $('profSpot').className='rounded-xl p-3 text-xs font-bold flex items-start gap-2.5 border bg-emerald-50 border-emerald-300 text-emerald-950';
    $('profSpot').innerHTML=`<i class="fa-solid fa-bullhorn text-emerald-600 text-base mt-0.5"></i><div><strong>حالة النشر الدعائي:</strong> مبروك! أنت شريك استراتيجي ويتم الإعلان عنك على www.nqs.sa والسوشيال ميديا.</div>`;
  }
  $('kpiTotal').textContent=fmtSAR(st.earned); $('kpiPaid').textContent=Math.round(st.paid).toLocaleString('en-US'); $('kpiPending').textContent=Math.round(st.pending).toLocaleString('en-US');

  $('leadsCount').textContent=st.leads.length;
  $('leadsList').innerHTML = st.leads.length ? st.leads.map(l=>leadCard(l,false)).join('') :
    `<div class="bg-white rounded-2xl p-6 border border-dashed border-slate-300 text-center space-y-2"><i class="fa-solid fa-folder-open text-2xl text-slate-400"></i><div class="text-sm font-black text-slate-700">لا يوجد عملاء مسجلون بعد</div><p class="text-xs text-slate-500 font-semibold">اضغط «عميل جديد» لإضافة أول عميل مرشح.</p></div>`;

  $('profName').textContent=p.name; $('profEmail').textContent=p.email; $('profTier').textContent=st.tier;
  $('profType').textContent=p.type==='individual'?'مستشار مستقل (Individual Partner)':'شريك مؤسسي (شركة / مكتب مهني)';
  $('profPhone').textContent=p.phone||'—'; $('profIban').textContent=maskIban(p.iban);
  const conv=st.leads.length?Math.round(c/st.leads.length*100):0;
  const stat=(l,v,cls='bg-[#f8fafc] border-slate-200',vc='')=>`<div class="${cls} p-3 rounded-xl border"><span class="text-[10px] font-bold text-slate-500 block">${l}</span><span class="text-lg font-black ${vc}">${v}</span></div>`;
  $('profStats').innerHTML = stat('إجمالي العملاء المرشحين',st.leads.length+' عملاء') + stat('المقبولون (غير مرفوضين)',(st.leads.length-st.rejected)+' عملاء','bg-[#f8fafc] border-slate-200','text-[#0e8388]')
    + stat('المقفولة ومعدل التحويل',`${c} (${conv}%)`,'bg-[#f8fafc] border-slate-200','text-emerald-700') + stat('إجمالي العمولات المستحقة',fmtSAR(st.earned),'bg-teal-50/70 border-teal-200','text-[#0e8388]')
    + stat('العمولات المحوّلة',fmtSAR(st.paid),'bg-emerald-50/70 border-emerald-200','text-emerald-700') + stat('الدفعات المجدولة',fmtSAR(st.pending),'bg-amber-50/70 border-amber-200','text-amber-700');
  $('payoutsList').innerHTML = myPayouts.length ? myPayouts.map(x=>payRow(x)).join('') : `<div class="text-xs font-bold text-slate-500 bg-slate-50 p-3 rounded-xl text-center">لا توجد تحويلات مالية مسجلة بعد.</div>`;
  $('calcDeal').value=Math.min(10,c+1); updateCalc();
}
function payRow(x,pname){
  const paid=x.status==='paid';
  return `<div class="bg-[#f8fafc] border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2 text-xs">
    <div class="min-w-0"><div class="flex items-center gap-1.5">${x.ref?`<span class="text-[10px] font-black text-slate-400" dir="ltr">${esc(x.ref)}</span>`:''}<span class="font-black truncate">${esc(x.client)}</span></div>
    <div class="text-[11px] font-bold text-slate-600 mt-0.5">${pname?`<span class="text-[#0e8388]">${esc(pname)}</span> • `:''}${esc(x.stage)} • <span dir="ltr">${esc(paid?x.paid_at:x.due)}</span></div></div>
    <div class="text-left shrink-0"><div class="font-black text-[#0e8388]">${fmtSAR(x.amount)}</div>
    <span class="inline-block text-[10px] font-black px-2 py-0.5 rounded ${paid?'bg-emerald-100 text-emerald-800':'bg-amber-100 text-amber-800'}">${paid?'محوّل':'مجدول'}</span></div></div>`;
}
function leadCard(l, admin, pname){
  const s=l.status, S=STATUS[s]||STATUS.pending, age=daysSince(l.submitted_at)||0, id=esc(l.id);
  const prot = s==='closed'?'مغلقة بنجاح':s==='rejected'?'الحماية ملغاة':`حماية الترشيح: متبقي ${Math.max(0,180-age)} يوم`;
  const comm = s==='closed'?`${fmtSAR(l.commission)} (الصفقة #${l.deal_no} - ${l.pct}%${+l.bonus?' + بونص':''})`:'محتسبة على السلم التصاعدي';
  const btn=(fn,cls,t)=>`<button onclick="${fn}" class="text-[11px] font-black px-2.5 py-1.5 rounded-lg ${cls}">${t}</button>`;
  const actions = admin ? `<div class="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
      ${s!=='approved'&&s!=='closed'?btn(`setLeadStatus('${id}','approved')`,'bg-sky-600 text-white','اعتماد وإسناد'):''}
      ${s!=='negotiation'&&s!=='closed'?btn(`setLeadStatus('${id}','negotiation')`,'bg-amber-500 text-white','تحت التفاوض'):''}
      ${s!=='closed'?btn(`openCloseDeal('${id}')`,'bg-emerald-600 text-white','إغلاق الصفقة'):''}
      ${s!=='rejected'&&s!=='closed'?btn(`openReject('${id}')`,'bg-red-50 text-red-700 border border-red-200','رفض'):''}
      ${s==='closed'||s==='rejected'?btn(`setLeadStatus('${id}','approved')`,'bg-slate-100 text-slate-600','إعادة فتح'):''}
    </div>` : '';
  return `<div class="bg-white rounded-2xl p-4 border border-[#e2e8f0] space-y-2.5">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0"><span class="text-[10px] font-black text-slate-400 block" dir="ltr">${esc(l.ticket)} • ${esc(dateOnly(l.submitted_at))}</span>
        <h4 class="text-sm font-black">${esc(l.company)}</h4><span class="text-[11px] font-bold text-[#0e8388]">${esc(l.industry)}</span>
        ${admin?`<div class="text-[11px] font-black text-amber-700 mt-0.5"><i class="fa-solid fa-handshake ml-1"></i>الشريك: ${esc(pname)}</div>`:''}</div>
      <span class="chip shrink-0 ${S.c}">${S.t}</span>
    </div>
    <div class="grid grid-cols-2 gap-2 bg-[#f8fafc] p-2.5 rounded-xl border border-slate-100 text-xs font-bold">
      <div><span class="text-[10px] text-slate-400 block">صاحب القرار:</span>${esc(l.customer)}<div class="text-[10px] text-slate-500">${esc(l.title)}</div></div>
      <div><span class="text-[10px] text-slate-400 block">الهاتف الأساسي:</span><span dir="ltr">${esc(l.phone)}</span>${l.other_phone?`<div class="text-[10px] text-slate-500" dir="ltr">${esc(l.other_phone)}</div>`:''}</div>
      ${admin&&(l.email||l.website)?`<div class="col-span-2 text-[11px]" dir="ltr">${esc(l.email)} ${esc(l.website)}</div>`:''}
      ${l.notes?`<div class="col-span-2 text-[11px] text-slate-600"><span class="text-slate-400">ملاحظات: </span>${esc(l.notes)}</div>`:''}
      ${l.admin_note?`<div class="col-span-2 text-[11px] text-purple-800"><span class="text-slate-400">رد الإدارة: </span>${esc(l.admin_note)}</div>`:''}
    </div>
    <div class="flex items-center justify-between text-[11px] font-extrabold"><span class="text-slate-600"><i class="fa-solid fa-shield-halved text-[#0e8388] ml-1"></i>${prot}</span><span class="text-[#0e8388] font-black">${comm}</span></div>
    ${actions}
  </div>`;
}

// ---------- tabs ----------
function switchTab(tab){
  currentTab=tab;
  ['Dashboard','AddLead','Calculator','Kit','Profile'].forEach(s=>$('screen'+s).classList.add('hidden'));
  $('screen'+tab[0].toUpperCase()+tab.slice(1)).classList.remove('hidden');
  document.querySelectorAll('#bottomNav .navbtn').forEach(b=>{
    b.className='navbtn min-h-[52px] rounded-xl flex flex-col items-center justify-center gap-1 transition '+(b.dataset.tab===tab?'text-[#0e8388] bg-teal-50 font-black':'text-slate-500 font-extrabold');
  });
  window.scrollTo({top:0,behavior:'smooth'});
}

// ---------- lead submission ----------
function resetCheck(){ lastCheck=null; $('checkBanner').classList.add('hidden'); }
async function checkPhone(){
  const raw=$('crmPhone').value.trim(), b=$('checkBanner');
  if(!raw){ showToast('أدخل رقم الهاتف الأساسي أولاً','error'); return; }
  b.className='rounded-xl p-3 text-xs font-bold border bg-slate-50 border-slate-200'; b.textContent='جارِ الفحص في السجل...'; b.classList.remove('hidden');
  let r; try{ r=lastCheck=await api('/phone-check','POST',{phone:raw}); }catch(error){ b.textContent='تعذّر الفحص: '+errMsg(error); return; }
  const set=(cls,html)=>{ b.className='rounded-xl p-3 text-xs font-bold leading-relaxed border '+cls; b.innerHTML=html; };
  if(r.state==='invalid') set('border-red-300 bg-red-50 text-red-950','رقم الهاتف غير صحيح.');
  else if(r.state==='mine') set('border-sky-300 bg-sky-50 text-sky-950','<strong>هذا العميل مسجّل مسبقاً باسمك</strong> وحمايته سارية.');
  else if(r.state==='claimed') set('border-red-300 bg-red-50 text-red-950','<strong><i class="fa-solid fa-ban ml-1"></i>مسجّل باسم شريك آخر</strong> — حماية الـ 180 يوماً سارية، لا يمكن تسجيله حالياً.');
  else if(r.state==='active_sales') set('border-red-300 bg-red-50 text-red-950',`<strong><i class="fa-solid fa-ban ml-1"></i>محمي للمبيعات المباشرة (آخر متابعة منذ ${r.days} يوم)</strong><br>الرقم يتابعه فريق المبيعات منذ أقل من 30 يوماً؛ لا يمكن تسجيله كفرصة شريك حالياً.`);
  else if(r.state==='stagnant') set('border-amber-300 bg-amber-50 text-amber-950',`<strong><i class="fa-solid fa-scale-balanced ml-1"></i>سجل راكد (${r.days} يوم دون متابعة) — يُرفع لمدير المبيعات</strong><br>يمكنك إكمال التسجيل وسيُرفع الطلب لمدير المبيعات لاعتماد حقك.`);
  else set('border-emerald-300 bg-emerald-50 text-emerald-950','<strong><i class="fa-solid fa-circle-check ml-1"></i>عميل جديد غير مسجل — متاح للتسجيل!</strong><br>عند الإرسال تُفعَّل حماية الترشيح 180 يوماً باسمك.');
  return r;
}
async function submitLead(e){
  e.preventDefault();
  const btn=$('btnSubmitLead'); busy(btn,true);
  try{
    let data;
    try{ data=await api('/leads','POST',{
      phone:$('crmPhone').value.trim(), customer:$('crmCustomer').value.trim(), title:$('crmTitle').value,
      company:$('crmCompany').value.trim(), industry:$('crmIndustry').value, email:$('crmEmail').value.trim(),
      other_phone:$('crmOther').value.trim(), website:$('crmWebsite').value.trim(), notes:$('crmNotes').value.trim() });
    }catch(error){ if(String(error.message).includes('BLOCKED')) await checkPhone(); throw error; }
    ['crmPhone','crmCustomer','crmCompany','crmEmail','crmOther','crmWebsite','crmNotes'].forEach(k=>$(k).value='');
    resetCheck(); await loadMine(); renderPortal(); switchTab('dashboard');
    showToast(data.status==='escalated'?`تم تسجيل (${data.company}) ورفعه لمدير المبيعات`:`تم تسجيل (${data.company}) وتفعيل حماية 180 يوماً!`,'success');
  }catch(err){ showToast(errMsg(err),'error'); }
  finally{ busy(btn,false); }
}

// ---------- modal ----------
function openModal(title, html, onSubmit){
  $('modalTitle').textContent=title; const f=$('modalForm'); f.innerHTML=html;
  f.onsubmit=async ev=>{ ev.preventDefault(); const b=f.querySelector('button[type=submit]'); busy(b,true); try{ await onSubmit(f); closeModal(); }catch(err){ if(!(err&&err.keepOpen)) showToast(errMsg(err),'error'); } busy(b,false); };
  $('modal').classList.remove('hidden'); $('modal').classList.add('flex');
}
function closeModal(){ $('modal').classList.add('hidden'); $('modal').classList.remove('flex'); }
function openEditProfile(){
  const p=myPartner;
  openModal('تحديث بيانات الحساب',`
    <div><label class="lbl">اسم الشريك / الجهة</label><input name="name" required maxlength="120" class="inp" value="${esc(p.name)}"></div>
    <div><label class="lbl">رقم الجوال</label><input name="phone" required dir="ltr" class="inp text-left" value="${esc(p.phone)}"></div>
    <div><label class="lbl">الآيبان البنكي</label><input name="iban" dir="ltr" maxlength="40" class="inp text-left" value="${esc(p.iban)}" placeholder="SA00 0000 ..."></div>
    <button type="submit" class="w-full bg-[#0e8388] text-white font-black py-3 rounded-xl text-sm">حفظ</button>`,
    async f=>{ await api('/me','PUT',{name:f.name.value.trim(),phone:f.phone.value.trim(),iban:f.iban.value.trim()});
      await loadMine(); renderPortal(); showToast('تم تحديث بياناتك','success'); });
}

// ---------- calculator & kit ----------
function updateCalc(){
  const v=parseFloat($('calcContract').value), n=parseInt($('calcDeal').value);
  $('calcLblContract').textContent=fmtSAR(v); $('calcLblDeal').textContent=`الصفقة رقم (${n})`;
  const idx=n<=2?0:n===3?1:n<=5?2:n===6?3:4;
  [...$('ladder').children].forEach((el,i)=>el.className='min-w-[105px] flex-1 rounded-xl p-2.5 text-center transition '+(i===idx?'bg-teal-50 border-2 border-[#0e8388]':'bg-slate-50 border border-slate-200'));
  let cum=0; for(let i=1;i<=n;i++){ const L=ladder(i); cum+=v*L.pct/100+L.bonus; }
  const L=ladder(n), single=v*L.pct/100+L.bonus;
  $('calcTier').textContent=L.label; $('calcSingle').textContent=fmtSAR(single); $('calcCum').textContent=fmtSAR(cum);
  $('calcI1').textContent=fmtSAR(single*.5); $('calcI2').textContent=fmtSAR(single*.25); $('calcI3').textContent=fmtSAR(single*.25);
}
function renderKit(){
  $('kitList').innerHTML=KIT.map((k,i)=>`<div class="bg-[#f8fafc] border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2">
    <div class="min-w-0"><span class="text-[10px] font-black text-[#0e8388] bg-teal-50 px-2 py-0.5 rounded">${k.tag}</span><div class="text-xs font-black mt-1">${k.title}</div></div>
    <div class="flex gap-1 shrink-0"><button type="button" onclick="copyText(KIT[${i}].text)" class="min-h-[40px] bg-slate-200 text-[#0f172a] text-xs font-black px-2.5 rounded-xl" title="نسخ"><i class="fa-solid fa-copy"></i></button>
    <button type="button" onclick="downloadText(KIT[${i}].file,KIT[${i}].text)" class="min-h-[40px] bg-[#0f172a] text-white text-xs font-black px-3 rounded-xl"><i class="fa-solid fa-download ml-1"></i>تنزيل</button></div></div>`).join('');
}

// ---------- admin ----------
function showPartnerSide(){
  if(myPartner){ showScreen('portal'); switchTab(currentTab); renderPortal(); }
  else { showScreen('auth'); switchAuthTab('register'); $('regEmail').value=me.email; notice('أنت مدير. لعرض البوابة كشريك، أكمل بيانات الشريك.','info'); }
}
async function showAdmin(){ if(!isAdmin) return; showScreen('admin'); switchAdminTab(adminTab); await loadAdmin(); }
async function loadAdmin(){
  try{ A=await api('/admin/data'); }catch(e){ showToast(errMsg(e),'error'); }
  renderAdmin();
}
function switchAdminTab(t){
  adminTab=t;
  ['leads','partners','payouts','crm'].forEach(k=>$('a'+k[0].toUpperCase()+k.slice(1)).classList.toggle('hidden',k!==t));
  document.querySelectorAll('#adminTabs .atab').forEach(b=>b.className='atab shrink-0 text-xs font-black px-3 py-1.5 rounded-xl '+(b.dataset.atab===t?'bg-amber-400 text-[#0f172a]':'bg-white/10 text-white'));
  renderAdmin();
}
const pName = id => (A.partners.find(p=>p.id===id)||{}).name||'—';
function renderAdmin(){
  if(currentView!=='admin') return;
  const open=A.leads.filter(x=>x.status==='pending'||x.status==='escalated');
  const sched=A.payouts.filter(x=>x.status!=='paid');
  $('aBadgeLeads').textContent=open.length; $('aBadgePay').textContent=sched.length;
  const k=(l,v,c='')=>`<div class="card !p-3"><span class="text-[10px] font-bold text-slate-500 block">${l}</span><span class="text-lg font-black ${c}">${v}</span></div>`;
  $('adminKpis').innerHTML=k('الشركاء المسجلون',A.partners.length)+k('ترشيحات بانتظار القرار',open.length,'text-amber-600')+k('صفقات مقفولة',A.leads.filter(x=>x.status==='closed').length,'text-emerald-700')+k('مستحقات غير مصروفة',fmtSAR(sched.reduce((s,x)=>s+(+x.amount||0),0)),'text-[#0e8388]');

  if(adminTab==='leads'){
    const filters={open:'بانتظار القرار',approved:'معتمد',negotiation:'تفاوض',closed:'مقفول',rejected:'مرفوض',all:'الكل'};
    $('leadFilters').innerHTML=Object.entries(filters).map(([k,t])=>`<button onclick="leadFilter='${k}';renderAdmin()" class="shrink-0 text-xs font-black px-3 py-1.5 rounded-xl border ${leadFilter===k?'bg-[#0f172a] text-white border-[#0f172a]':'bg-white text-slate-600 border-slate-200'}">${t}</button>`).join('');
    const q=$('leadSearch').value.trim().toLowerCase();
    let list=A.leads.filter(x=>leadFilter==='all'||(leadFilter==='open'?(x.status==='pending'||x.status==='escalated'):x.status===leadFilter));
    if(q) list=list.filter(x=>[x.company,x.phone,x.customer,pName(x.partner_id)].join(' ').toLowerCase().includes(q));
    $('aLeadsList').innerHTML=list.length?list.map(x=>leadCard(x,true,pName(x.partner_id))).join(''):'<div class="text-xs font-bold text-slate-500 text-center p-6 bg-white rounded-2xl border border-dashed">لا توجد ترشيحات في هذا التصنيف.</div>';
  }
  if(adminTab==='partners'){
    const arr=A.partners.map(p=>({p,st:partnerStats(p,A.leads.filter(l=>l.partner_id===p.id),A.payouts.filter(x=>x.partner_id===p.id))})).sort((a,b)=>b.st.closed-a.st.closed||b.st.leads.length-a.st.leads.length);
    $('aPartnersList').innerHTML=arr.length?arr.map(({p,st})=>`<div class="card space-y-2">
      <div class="flex items-start justify-between gap-2"><div class="min-w-0"><h4 class="text-sm font-black">${esc(p.name)}</h4><div class="text-[11px] font-bold text-slate-500" dir="ltr">${esc(p.email)} • ${esc(p.phone)}</div>
      <div class="text-[10px] font-bold text-slate-400">${p.type==='individual'?'مستشار مستقل':'شركة / مكتب'} • انضم ${esc(dateOnly(p.created_at))} • IBAN: <span dir="ltr">${esc(p.iban||'—')}</span></div></div>
      <div class="flex flex-col items-end gap-1 shrink-0"><span class="chip ${st.strategic?'bg-amber-50 text-amber-800 border-amber-200':'bg-teal-50 text-[#0e8388] border-teal-200'}">${st.tier}</span>
      ${(st.idle??0)>=90?'<span class="chip bg-red-50 text-red-700 border-red-200">خامل +90 يوم</span>':''}</div></div>
      <div class="grid grid-cols-4 gap-1.5 text-center text-[10px] font-bold">
        <div class="bg-slate-50 rounded-lg p-1.5">ترشيحات<div class="text-sm font-black">${st.leads.length}</div></div>
        <div class="bg-slate-50 rounded-lg p-1.5">الربع الحالي<div class="text-sm font-black">${st.quarter}/6</div></div>
        <div class="bg-slate-50 rounded-lg p-1.5">مقفولة<div class="text-sm font-black text-emerald-700">${st.closed}</div></div>
        <div class="bg-slate-50 rounded-lg p-1.5">مستحق/محوّل<div class="text-[11px] font-black text-[#0e8388]">${Math.round(st.earned).toLocaleString('en-US')}/${Math.round(st.paid).toLocaleString('en-US')}</div></div>
      </div><div class="flex items-center justify-between"><span class="text-[10px] font-bold text-slate-500">آخر نشاط منذ ${st.idle??'—'} يوم</span><button onclick="resetPartnerPassword('${esc(p.id)}')" class="text-[10px] font-black bg-slate-100 px-2 py-1 rounded-lg"><i class="fa-solid fa-key ml-1"></i>إعادة تعيين كلمة المرور</button></div></div>`).join(''):'<div class="text-xs font-bold text-slate-500 text-center p-6 bg-white rounded-2xl border border-dashed">لم ينضم أي شريك بعد. شارك رابط البوابة مع شركائك.</div>';
  }
  if(adminTab==='payouts'){
    $('payFilters').innerHTML=[['scheduled','مجدولة'],['paid','محوّلة'],['all','الكل']].map(([k,t])=>`<button onclick="payFilter='${k}';renderAdmin()" class="text-xs font-black px-3 py-1.5 rounded-xl border ${payFilter===k?'bg-[#0f172a] text-white border-[#0f172a]':'bg-white text-slate-600 border-slate-200'}">${t}</button>`).join('');
    const list=A.payouts.filter(x=>payFilter==='all'||(payFilter==='paid'?x.status==='paid':x.status!=='paid'));
    $('aPayoutsList').innerHTML=list.length?list.map(x=>{
      const due=x.status!=='paid'&&x.due<=todayISO();
      return `<div class="space-y-1">${payRow(x,pName(x.partner_id))}${x.status!=='paid'?`<div class="flex justify-between items-center px-1"><span class="text-[10px] font-black ${due?'text-red-600':'text-slate-400'}">${due?'مستحقة الآن':'تستحق في '+esc(x.due)}</span><button onclick="openPay('${esc(x.id)}')" class="text-[11px] font-black bg-emerald-600 text-white px-3 py-1 rounded-lg">تسجيل التحويل</button></div>`:''}</div>`;}).join(''):'<div class="text-xs font-bold text-slate-500 text-center p-6 bg-white rounded-2xl border border-dashed">لا توجد دفعات.</div>';
  }
  if(adminTab==='crm'){
    const q=$('crmSearch').value.trim().toLowerCase();
    let arr=A.phones; if(q) arr=arr.filter(r=>(r.phone_key+' '+r.company+' '+r.owner).toLowerCase().includes(q));
    $('aCrmList').innerHTML=arr.length?arr.slice(0,300).map(r=>{
      const d=daysSince(r.last_activity), k=esc(r.phone_key);
      return `<div class="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-2 text-xs">
        <div class="min-w-0"><div class="font-black" dir="ltr">0${k}</div><div class="font-bold text-slate-600 truncate">${esc(r.company)} ${r.owner?'• '+esc(r.owner):''}</div></div>
        <div class="text-left shrink-0"><span class="chip ${d<30?'bg-red-50 text-red-700 border-red-200':'bg-amber-50 text-amber-800 border-amber-200'}">${d<30?'متابع':'راكد'} • ${d} يوم</span>
        <div class="flex gap-1 mt-1 justify-end"><button onclick="touchPhone('${k}')" title="تحديث آخر نشاط لليوم" class="text-[10px] font-black bg-slate-100 px-2 py-0.5 rounded"><i class="fa-solid fa-rotate"></i></button>
        <button onclick="deletePhone('${k}')" title="حذف" class="text-[10px] font-black bg-red-50 text-red-700 px-2 py-0.5 rounded"><i class="fa-solid fa-trash"></i></button></div></div></div>`;}).join(''):'<div class="text-xs font-bold text-slate-500 text-center p-6 bg-white rounded-2xl border border-dashed">السجل فارغ. أضف أرقام عملاء الـ CRM أعلاه.</div>';
  }
}
async function setLeadStatus(id,status,note){
  try{ await api('/admin/leads/'+id+'/status','POST',{status,note:note??null}); }catch(e){ return showToast(errMsg(e),'error'); }
  showToast('تم تحديث حالة الترشيح','success'); await loadAdmin();
}
function openReject(id){
  openModal('رفض الترشيح',`<div><label class="lbl">سبب الرفض (يظهر للشريك)</label><textarea name="note" rows="3" required class="inp" placeholder="مثال: العميل خارج الفئة المستهدفة"></textarea></div>
    <button type="submit" class="w-full bg-red-600 text-white font-black py-3 rounded-xl text-sm">تأكيد الرفض</button>`,
    async f=>{ await setLeadStatus(id,'rejected',f.note.value.trim()); });
}
function openCloseDeal(id){
  const lead=A.leads.find(l=>l.id===id)||{};
  const n=A.leads.filter(l=>l.partner_id===lead.partner_id&&l.status==='closed'&&l.id!==id).length+1, T=ladder(n);
  openModal('إغلاق الصفقة واحتساب العمولة',`
    <div class="bg-teal-50 border border-teal-200 rounded-xl p-3 text-xs font-bold">${esc(lead.company)} — الصفقة رقم <strong>#${n}</strong> للشريك ${esc(pName(lead.partner_id))}<br>${T.label}</div>
    <div><label class="lbl">قيمة العقد (ر.س) *</label><input name="value" type="number" min="1" step="1" required class="inp" dir="ltr" placeholder="100000" oninput="this.form.querySelector('#cdPrev').textContent=this.value?('العمولة: '+fmtSAR(this.value*${T.pct}/100+${T.bonus})):''"></div>
    <div><label class="lbl">تاريخ التوقيع</label><input name="date" type="date" required class="inp" dir="ltr" value="${todayISO()}"></div>
    <div id="cdPrev" class="text-sm font-black text-[#0e8388]"></div>
    <p class="text-[11px] font-bold text-slate-500">ستُجدول تلقائياً 3 دفعات: 50% عند التوقيع، 25% بعد 30 يوماً، 25% بعد 60 يوماً.</p>
    <button type="submit" class="w-full bg-emerald-600 text-white font-black py-3 rounded-xl text-sm">إغلاق وجدولة الدفعات</button>`,
    async f=>{ const data=await api('/admin/leads/'+id+'/close','POST',{value:Math.round(+f.value.value),date:f.date.value});
      showToast(`تم إغلاق الصفقة — عمولة ${fmtSAR(data.commission)}`,'success'); await loadAdmin(); });
}
function openPay(id){
  const x=A.payouts.find(p=>p.id===id)||{}, partner=A.partners.find(p=>p.id===x.partner_id)||{};
  openModal('تسجيل تحويل بنكي',`<div class="bg-slate-50 border rounded-xl p-3 text-xs font-bold">${esc(x.client)} — ${esc(x.stage)}<br><strong class="text-[#0e8388]">${fmtSAR(x.amount)}</strong> إلى IBAN: <span dir="ltr">${esc(partner.iban||'غير مسجل')}</span></div>
    <div><label class="lbl">رقم مرجع التحويل *</label><input name="ref" required maxlength="40" dir="ltr" class="inp text-left" placeholder="TRX-0000"></div>
    <div><label class="lbl">تاريخ التحويل</label><input name="date" type="date" required dir="ltr" class="inp" value="${todayISO()}"></div>
    <button type="submit" class="w-full bg-emerald-600 text-white font-black py-3 rounded-xl text-sm">تأكيد التحويل</button>`,
    async f=>{ await api('/admin/payouts/'+id+'/pay','POST',{ref:f.ref.value.trim(),date:f.date.value});
      showToast('تم تسجيل التحويل','success'); await loadAdmin(); });
}
async function importCrm(){
  const rows=[]; let bad=0;
  $('crmBulk').value.split('\n').map(s=>s.trim()).filter(Boolean).forEach(line=>{
    const [ph,company,date,owner]=line.split(/[,،\t]/).map(s=>(s||'').trim());
    const key=normPhone(ph); if(key.length<7){ bad++; return; }
    rows.push({phone_key:key,company:company||'',last_activity:/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:todayISO(),owner:owner||'فريق المبيعات المباشر'});
  });
  if(!rows.length) return showToast('لا توجد أسطر صالحة','error');
  const btn=$('btnCrmImport'); busy(btn,true);
  try{ await api('/admin/crm','POST',{rows}); }catch(error){ busy(btn,false); return showToast(errMsg(error),'error'); }
  busy(btn,false);
  $('crmBulk').value=''; showToast(`تم حفظ ${rows.length} رقم${bad?` — تم تجاهل ${bad} سطر غير صالح`:''}`,'success'); await loadAdmin();
}
async function touchPhone(k){ try{ await api('/admin/crm/'+k+'/touch','POST'); }catch(e){ return showToast(errMsg(e),'error'); } await loadAdmin(); }
async function deletePhone(k){ try{ await api('/admin/crm/'+k,'DELETE'); }catch(e){ return showToast(errMsg(e),'error'); } await loadAdmin(); }

function resetPartnerPassword(id){
  const p=A.partners.find(x=>x.id===id)||{};
  openModal('إعادة تعيين كلمة مرور الشريك',`<div class="text-xs font-bold">سيتم إنشاء كلمة مرور مؤقتة جديدة لـ <strong>${esc(p.name)}</strong> (${esc(p.email)}). أرسلها له ليغيّرها من «حسابي».</div>
    <div id="tmpPass" class="hidden text-center text-lg font-black bg-teal-50 border border-teal-200 rounded-xl p-3" dir="ltr"></div>
    <button type="submit" class="w-full bg-[#0f172a] text-white font-black py-3 rounded-xl text-sm">إنشاء كلمة مرور مؤقتة</button>`,
    async f=>{ const d=await api('/admin/partners/'+id+'/reset-password','POST'); const el=f.querySelector('#tmpPass'); el.textContent=d.password; el.classList.remove('hidden');
      f.querySelector('button[type=submit]').outerHTML=`<button type="button" onclick="copyText('${d.password}')" class="w-full bg-[#0e8388] text-white font-black py-3 rounded-xl text-sm">نسخ</button>`; throw {keepOpen:true}; });
}
