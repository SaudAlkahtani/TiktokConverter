import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { config } from './config.js';

export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const within = (root, file) => { const relative = path.relative(root, file); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };

// Selectors are calibrated from the actual signed-in account, not guessed from
// third-party examples. Missing/changed controls block submission, not skip it.
export class TikTokBrowser {
  constructor(settings = config) { this.settings = settings; this.context = null; this.page = null; this.prepared = null; this.busy = false; }
  async manifest() {
    try { return JSON.parse(await fs.readFile(path.join(this.settings.tiktok.settingsPath, 'studio-controls.json'), 'utf8')); }
    catch { throw new Error('TikTok Studio controls need calibration after login. See docs/TIKTOK.md. Nothing was published.'); }
  }
  async connect() {
    if (!this.context) {
      this.context = await chromium.launchPersistentContext(this.settings.tiktok.profilePath, {
        channel: this.settings.tiktok.browserChannel, headless: false, locale: 'en-US', timezoneId: this.settings.tiktok.timezone,
        viewport: {width:1280,height:900}
      });
      this.context.on('close', () => { this.context = null; this.page = null; this.prepared = null; });
      this.page = this.context.pages()[0] || await this.context.newPage();
      this.page.setDefaultTimeout(15000);
    }
    if (!this.page.url().startsWith('https://www.tiktok.com/tiktokstudio')) await this.page.goto('https://www.tiktok.com/tiktokstudio/upload');
    return { browserOpen: true, message: 'Log in manually to Saud fitness journey. Do not give the bot your password or bypass a security challenge.' };
  }
  async unique(selector) {
    if (!selector) throw new Error('A required Studio control is not configured. Nothing was published.');
    const locator = this.page.locator(selector);
    if (await locator.count() !== 1) throw new Error('TikTok Studio changed or a control is ambiguous. Recalibrate before publishing.');
    return locator;
  }
  async account(manifest) {
    if (!this.settings.tiktok.handle) throw new Error('Set the exact TIKTOK_HANDLE first; a display name is not enough.');
    if (!this.page) throw new Error('Open the TikTok login browser first.');
    const location=new URL(this.page.url());
    if(location.origin!=='https://www.tiktok.com' || !location.pathname.startsWith('/tiktokstudio')) throw new Error('Browser is not on the trusted TikTok Studio page.');
    const text = await this.page.locator('body').innerText();
    if (/log in to tiktok|complete the captcha|security verification/i.test(text)) throw new Error('TikTok needs a manual login or security check on this computer.');
    const locator = await this.unique(manifest.accountSelector);
    const observed = ((await locator.textContent()) || '').trim();
    const href = await locator.getAttribute('href');
    const expected = this.settings.tiktok.handle.toLowerCase();
    const matches = observed.replace(/^@/, '').toLowerCase() === expected ||
      (href && new URL(href, this.page.url()).pathname.replace(/\/$/, '').toLowerCase() === `/@${expected}`);
    if (!matches) throw new Error('Signed-in TikTok account does not match the configured handle. Upload blocked.');
    return `@${this.settings.tiktok.handle}`;
  }
  async inventory() {
    if (!this.page) throw new Error('Open the TikTok login browser first.');
    // This reads only visible DOM controls; it does not call undocumented APIs.
    return this.page.evaluate(() => {
      const selectorFor = (element) => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        for (const attr of ['data-e2e','name','aria-label']) {
          const value=element.getAttribute(attr); if (value) {
            const selector=`${element.tagName.toLowerCase()}[${attr}=${JSON.stringify(value)}]`;
            if (document.querySelectorAll(selector).length === 1) return selector;
          }
        }
        const parts=[]; let node=element;
        while(node && node!==document.body) {
          const peers=[...node.parentElement.children].filter((s)=>s.tagName===node.tagName);
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${peers.indexOf(node)+1})`); node=node.parentElement;
        }
        return `body > ${parts.join(' > ')}`;
      };
      return [...document.querySelectorAll('input,select,textarea,[contenteditable="true"],[role="checkbox"],[role="switch"],button,a[href*="/@"]')]
        .filter((e)=>e.getClientRects().length || e.type==='file').map((e)=>({
          selector:selectorFor(e), kind:e.type || e.getAttribute('role') || e.tagName.toLowerCase(),
          label:(e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.getAttribute('placeholder') || e.innerText || '').trim().slice(0,160),
          options:e.tagName==='SELECT'?[...e.options].map((o)=>({label:o.text,value:o.value})):undefined,
          min:e.min || undefined,max:e.max || undefined,disabled:Boolean(e.disabled)
        }));
    });
  }
  async readField(field) {
    const locator = await this.unique(field.selector);
    if (field.kind==='checkbox') return locator.isChecked();
    if (field.kind==='switch') return (await locator.getAttribute('aria-checked'))==='true';
    if (field.kind==='contenteditable') return (await locator.innerText()).trim();
    return locator.inputValue();
  }
  async setField(field, value) {
    const locator = await this.unique(field.selector);
    if (field.kind==='checkbox') await locator.setChecked(value===true || value==='true');
    else if (field.kind==='switch') { if (await this.readField(field)!==(value===true || value==='true')) await locator.click(); }
    else if (field.kind==='select') await locator.selectOption(String(value));
    else if (field.kind==='contenteditable') await locator.fill(String(value));
    else if (['text','date','time','number','textarea','datetime-local'].includes(field.kind)) await locator.fill(String(value));
    else throw new Error(`Unsupported interactive control ${field.label}. Finish this setting manually in Studio; do not publish through an unverified adapter.`);
    const actual = await this.readField(field);
    if (String(actual)!==String(value)) throw new Error(`TikTok did not retain the requested ${field.label}. Nothing was published.`);
  }
  async readState(manifest) {
    const fields={};
    for(const [id,field] of Object.entries(manifest.fields || {})) fields[id]=await this.readField(field);
    return { account:await this.account(manifest), caption:await this.readField({selector:manifest.captionSelector,kind:manifest.captionKind || 'contenteditable'}), fields };
  }
  async prepare(draft) {
    if (this.busy || this.prepared) throw new Error('Another TikTok review is open. Publish it or use /cancelpost before preparing another.');
    this.busy=true;
    try {
      await this.connect(); const manifest=await this.manifest();
      await this.account(manifest); // Verify identity before sending any file.
      if (!within(this.settings.directories.output,draft.outputPath)) throw new Error('Only converter outputs may be uploaded.');
      await fs.access(draft.outputPath);
      await (await this.unique(manifest.fileInputSelector)).setInputFiles(draft.outputPath);
      await (await this.unique(manifest.captionSelector)).waitFor({state:'visible',timeout:180000});
      await this.setField({selector:manifest.captionSelector,kind:manifest.captionKind || 'contenteditable',label:'Caption'},draft.caption);
      for(const [id,value] of Object.entries(draft.options || {})) {
        if (!manifest.fields?.[id]) throw new Error(`Studio option ${id} is not mapped. Nothing was published.`);
        await this.setField(manifest.fields[id],value);
      }
      if (draft.schedule) {
        for(const [key,value] of [['schedule',true],['scheduleDate',draft.schedule.date],['scheduleTime',draft.schedule.time]]) {
          if (!manifest.fields?.[key]) throw new Error('Scheduling controls are not available/calibrated for this account. Posting now is never used as a fallback.');
          await this.setField(manifest.fields[key],value);
        }
      } else if (manifest.fields?.schedule) await this.setField(manifest.fields.schedule,false);
      const review=await this.readState(manifest);
      const screenshot=path.join(this.settings.tiktok.settingsPath,`review-${draft.id}.png`);
      await fs.mkdir(this.settings.tiktok.settingsPath,{recursive:true}); await this.page.screenshot({path:screenshot,fullPage:true});
      this.prepared={id:draft.id,hash:digest(review),review,manifest};
      return {review,screenshot};
    } finally { this.busy=false; }
  }
  async submit(draft) {
    if (this.busy || this.prepared?.id!==draft.id) throw new Error('No matching live Studio review. Prepare the video again.');
    const prepared=this.prepared;
    if (digest(await this.readState(prepared.manifest))!==prepared.hash) throw new Error('Studio settings changed after review. Prepare and confirm again.');
    const selector=draft.schedule?prepared.manifest.scheduleSubmitSelector:prepared.manifest.postSelector;
    const success=draft.schedule?prepared.manifest.scheduledSuccessSelector:prepared.manifest.successSelector;
    if (!success) throw new Error('A verifiable Studio success indicator is required before publishing.');
    const submit=await this.unique(selector);
    const buttonText=(await submit.innerText()).trim();
    if(!/^(post|publish|schedule|schedule post)$/i.test(buttonText)) throw new Error('Configured submission control is not a recognized publish/schedule button.');
    if (!await submit.isEnabled()) throw new Error('TikTok is still processing or checking the file. Nothing was submitted.');
    this.busy=true;
    try {
      await submit.click();
      // Missing success after a click is UNKNOWN, never automatically retried.
      await this.page.locator(success).waitFor({state:'visible',timeout:90000});
      this.prepared=null; return {status:draft.schedule?'scheduled':'published',url:this.page.url()};
    } finally { this.busy=false; }
  }
  async cancel(id) { if(this.prepared?.id===id) { this.prepared=null; if(this.page) await this.page.goto('https://www.tiktok.com/tiktokstudio/upload'); } }
  async close() { await this.context?.close(); }
}
