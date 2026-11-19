# بوابة شركاء NQ-ERP — Node.js + SQL Server

بوابة الشركاء كاملة (تسجيل ودخول، ترشيح العملاء بقاعدة الـ 30 يوماً وحماية الـ 180 يوماً، التارجت، سلم العمولات، جدولة الصرف 50/25/25، لوحة إدارة) تعمل على استضافة **MonsterASP.NET** مع قاعدة **SQL Server** الخاصة بكم.

- الموقع: `http://nqcustomers.runasp.net`
- قاعدة البيانات: `db81165.public.databaseasp.net`
- **الجداول تُنشأ تلقائياً** عند أول تشغيل (كلها تبدأ بـ `nq_`)، فلا حاجة لتشغيل أي SQL يدوياً.

## هيكل المشروع

```
src/server.js            ← كود الخادم (Express + mssql)
deploy/                  ← هذا المجلد هو ما يُرفع إلى wwwroot
  server.js              ← نسخة مجمّعة من الخادم (لا تحتاج node_modules)
  web.config             ← تشغيل Node.js على IIS
  public/                ← الواجهة (index.html + app.js)
  secrets.example.json   ← نموذج ملف الأسرار
.github/workflows/deploy.yml ← النشر التلقائي من GitHub
```

## ملف الأسرار `secrets.json` (لا يُرفع إلى GitHub أبداً)

```json
{
  "DB_CONNECTION": "Server=db81165.public.databaseasp.net; Database=db81165; User Id=db81165; Password=كلمة_مرور_القاعدة; Encrypt=True; TrustServerCertificate=True;",
  "SESSION_SECRET": "نص عشوائي طويل (40 حرفاً أو أكثر)",
  "ADMIN_EMAILS": ["sales14@nqs.sa"]
}
```
أي بريد في `ADMIN_EMAILS` يفتح له **لوحة الإدارة** تلقائياً بعد التسجيل.

---

## الطريقة 1: النشر التلقائي من GitHub (موصى بها)

كل `push` على الفرع `main` ينشر الموقع تلقائياً.

1. ارفع المشروع إلى مستودع GitHub.
2. في المستودع: **Settings → Secrets and variables → Actions → New repository secret** وأضف:

| الاسم | القيمة |
|---|---|
| `WEBDEPLOY_PASSWORD` | كلمة مرور Web Deploy (قيمة `userPWD` في ملف publishSettings) |
| `DB_CONNECTION` | نص الاتصال الكامل بقاعدة البيانات **مع كلمة المرور** |
| `ADMIN_EMAILS` | بريد المدير (أكثر من بريد: افصل بفاصلة) |
| `SESSION_SECRET` | اختياري — نص عشوائي طويل لتوقيع الجلسات |

3. **Actions → Deploy to MonsterASP → Run workflow** (أو أي push).
4. آخر خطوة في الـ workflow تفتح `/api/health` وتطبع النتيجة: `"db":"connected"` تعني أن كل شيء يعمل.

## الطريقة 2: رفع يدوي (ZIP)

1. أنشئ `deploy/secrets.json` من النموذج أعلاه.
2. اضغط محتويات مجلد `deploy` (وليس المجلد نفسه) في ملف ZIP.
3. لوحة MonsterASP → الموقع → **File Manager / Deploy → ZIP deployment** وارفع الملف إلى `wwwroot`.

## التحقق بعد النشر
- افتح `http://nqcustomers.runasp.net/api/health`
  - `{"ok":true,"db":"connected"}` ← جاهز.
  - `"secretsFile":false` ← ملف `secrets.json` غير موجود.
  - رسالة خطأ اتصال ← راجع كلمة المرور، وتأكد من **السماح بالوصول عن بُعد للقاعدة** من لوحة MonsterASP (Databases → MSSQL → Remote access) إن كانت معطّلة.
- لو لم يعمل الموقع إطلاقاً: فعّل سجل Node.js بتغيير `stdoutLogEnabled="true"` في `web.config` واقرأ مجلد `logs`.
- يُنصح بتفعيل **HTTPS** من لوحة MonsterASP (شهادة مجانية).

## أول تشغيل
1. افتح الموقع → **انضمام شريك جديد** بالبريد المكتوب في `ADMIN_EMAILS` → ستفتح لوحة الإدارة.
2. لوحة الإدارة → **سجل أرقام CRM** → الصق أرقام عملاء الـ CRM الحاليين (سطر لكل عميل):
   `0558716079, شركة سفاير التميز, 2026-11-07, فريق المبيعات`
3. شارك رابط الموقع مع الشركاء.

## الأمان
- كلمات المرور مشفّرة (bcrypt)، والجلسة في كوكي HttpOnly موقّع.
- كل الصلاحيات والحسابات (قاعدة 30/180 يوماً، رقم الصفقة، النسبة، البونص، الدفعات) تُحسب في الخادم؛ الشريك لا يرى إلا بياناته ولا يعدّل الحالات أو العمولات.
- حماية من تخمين كلمة المرور (10 محاولات / 15 دقيقة).
- نسيان كلمة المرور: المدير يُنشئ كلمة مرور مؤقتة من **لوحة الإدارة → الشركاء**.

## تطوير محلي
```bash
npm install
cp deploy/secrets.example.json deploy/secrets.json   # وعدّله
npm run build && npm start                           # http://localhost:3000
```
