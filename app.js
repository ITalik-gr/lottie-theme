const $ = s => document.querySelector(s);
const hex = c => '#' + c.slice(0,3).map(v => Math.round(Math.max(0,Math.min(1,v>1?v/255:v))*255).toString(16).padStart(2,'0')).join('').toUpperCase();
const rgb = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16)/255);

// --- collect every color slot in a lottie doc: returns [{hex, set(rgbArr)}]
function collect(node, out){
  if (Array.isArray(node)) { node.forEach(n => collect(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  for (const k in node){
    const v = node[k];
    if (k === 'c' && v && typeof v === 'object' && 'k' in v){
      const kk = v.k;
      if (Array.isArray(kk) && kk.length && typeof kk[0] === 'number')
        out.push({hex: hex(kk), set: c => { kk[0]=c[0]; kk[1]=c[1]; kk[2]=c[2]; }});
      else if (Array.isArray(kk)) kk.forEach(st => ['s','e'].forEach(f => {
        if (Array.isArray(st[f]) && st[f].length>=3) out.push({hex: hex(st[f]), set: c => { st[f][0]=c[0]; st[f][1]=c[1]; st[f][2]=c[2]; }});
      }));
      continue;
    }
    if (k === 'g' && v && v.k && Array.isArray(v.k.k)){
      const arr = v.k.k, n = v.p || Math.floor(arr.length/4);
      for (let i=0;i<n;i++){ const o=i*4; if (arr.length>=o+4)
        out.push({hex: hex(arr.slice(o+1,o+4)), set: c => { arr[o+1]=c[0]; arr[o+2]=c[1]; arr[o+3]=c[2]; }}); }
      continue;
    }
    collect(v, out);
  }
}

let orig = null, anim = null, map = {}, curFile = null, hlColor = null, blink = 0;

const PRESETS = {
  "dark → light (base)": {
    "#17181D":"#FFFFFF", "#08090C":"#E3E6EF", "#000000":"#FFFFFF",
    "#24252A":"#F6F8FF", "#FFFFFF":"#17181D",
    "#9E9EA1":"#B2B5C1", "#BDBDBD":"#B2B5C1",
    "#38E887":"#008934", "#4C6EFC":"#4D6DFC"
  }
};

function build(){
  const doc = JSON.parse(JSON.stringify(orig));
  const slots = []; collect(doc, slots);
  slots.forEach(s => {
    let t = map[s.hex];
    if (hlColor && s.hex === hlColor && blink) t = '#FF00FF';
    if (t) s.set(rgb(t));
  });
  return doc;
}

function render(){
  if (anim) anim.destroy();
  anim = lottie.loadAnimation({container: $('#anim'), renderer:'svg', loop:true, autoplay:true,
    animationData: $('#cmp').checked ? JSON.parse(JSON.stringify(orig)) : build()});
}

function palette(){
  const slots = []; collect(JSON.parse(JSON.stringify(orig)), slots);
  const cnt = {}; slots.forEach(s => cnt[s.hex] = (cnt[s.hex]||0)+1);
  const el = $('#pal'); el.innerHTML = '';
  Object.entries(cnt).sort((a,b)=>b[1]-a[1]).forEach(([h,n]) => {
    const cur = map[h] || h;
    const d = document.createElement('div'); d.className = 'sw';
    d.innerHTML = `<div class="chip" style="background:${h}"></div>
      <div><code>${h}</code><div class="n">${n}×</div></div>
      <span>→</span>
      <input type="color" value="${cur}"><input type="text" class="hexin" value="${cur}">
      <button class="iso">find</button>`;
    const [ci, ti] = [d.querySelector('input[type=color]'), d.querySelector('.hexin')];
    const upd = v => { v = v.toUpperCase(); if(!/^#[0-9A-F]{6}$/.test(v)) return; map[h] = v; ci.value = v; ti.value = v; render(); };
    ci.oninput = e => upd(e.target.value); ti.onchange = e => upd(e.target.value);
    d.querySelector('.iso').onclick = () => { hlColor = hlColor === h ? null : h; palette(); };
    if (hlColor === h) d.classList.add('hl');
    el.appendChild(d);
  });
}

async function open(f){
  curFile = f; map = {}; hlColor = null;
  orig = await (await fetch(f.split('/').map(encodeURIComponent).join('/'))).json();
  $('#name').innerHTML = `<small>${f} — ${orig.w}×${orig.h}, ${orig.fr}fps</small>`;
  document.querySelectorAll('.f').forEach(e => e.classList.toggle('on', e.dataset.f === f));
  palette(); render();
}

setInterval(() => { if (hlColor){ blink = !blink; render(); } }, 550);

$('#bg').onchange = e => $('#box').style.background = e.target.value;
$('#bg').onchange({target:$('#bg')});
$('#cmp').onchange = render;
$('#chk').onchange = e => $('#box').style.backgroundImage = e.target.checked
  ? 'repeating-conic-gradient(#cfd2da 0% 25%, #fff 0% 50%)' : 'none';
$('#chk').addEventListener('change', () => $('#box').style.backgroundSize = '16px 16px');
$('#play').onclick = () => anim && (anim.isPaused ? anim.play() : anim.pause());
$('#reset').onclick = () => { map = {}; hlColor = null; palette(); render(); };
$('#dl').onclick = () => {
  const b = new Blob([JSON.stringify(build())], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = curFile.split('/').pop().replace('.json','_light.json'); a.click();
};
$('#cli').onclick = () => {
  const args = Object.entries(map).map(([a,b]) => `${a}=${b}`).join(' ');
  navigator.clipboard.writeText(`python3 tools/colors.py map "${curFile}" "${curFile.replace('.json','_light.json')}" ${args}`);
  $('#cli').textContent = 'copied!'; setTimeout(()=>$('#cli').textContent='Copy CLI map', 1200);
};

const psel = $('#preset');
Object.keys(PRESETS).forEach(k => psel.add(new Option(k,k)));
psel.onchange = e => { if(!e.target.value) return; Object.assign(map, PRESETS[e.target.value]); palette(); render(); e.target.value=''; };
$('#ptxt').innerHTML = Object.entries(PRESETS['dark → light (base)'])
  .map(([a,b])=>`<div class="row"><span class="chip" style="width:14px;height:14px;border-radius:4px;background:${a}"></span><code>${a}</code>→<span class="chip" style="width:14px;height:14px;border-radius:4px;background:${b}"></span><code>${b}</code></div>`).join('');

fetch('manifest.json').then(r=>r.json()).then(list => {
  const t = $('#tree'); let dir = null;
  list.forEach(f => {
    const d = f.split('/').slice(0,-1).join('/');
    if (d !== dir){ dir = d; t.insertAdjacentHTML('beforeend', `<div class="dir">${d}</div>`); }
    const e = document.createElement('div'); e.className='f'; e.dataset.f=f;
    e.textContent = f.split('/').pop(); e.onclick = () => open(f); t.appendChild(e);
  });
  const first = list.find(f => f.includes('How to invest/Illustration 1'));
  if (first) open(first);
});
