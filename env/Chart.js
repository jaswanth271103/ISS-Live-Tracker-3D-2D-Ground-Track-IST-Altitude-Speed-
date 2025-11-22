<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
// --- environmental charts using Chart.js ---
const ctxA = document.getElementById('chartAtmos').getContext('2d');
const ctxE = document.getElementById('chartEnergy').getContext('2d');
const ctxF = document.getElementById('chartFire').getContext('2d');

function emptyDataset() {
  return {labels:[], datasets:[{label:'value', data:[], borderColor:'#4da6ff', tension:0.2, pointRadius:0}]};
}

let chartAtmos = new Chart(ctxA, {type:'line', data:emptyDataset(), options:{responsive:true, plugins:{legend:{display:false}}}});
let chartEnergy = new Chart(ctxE, {type:'line', data:emptyDataset(), options:{responsive:true, plugins:{legend:{display:false}}}});
let chartFire = new Chart(ctxF, {type:'bar', data:emptyDataset(), options:{responsive:true, plugins:{legend:{display:false}}}});

async function fetchEnv() {
  try {
    const res = await fetch('/env');
    if(!res.ok) return;
    const j = await res.json();
    const samples = j.samples || [];
    // simple grouping: POWER -> temperature/solar; FIRMS -> fire_count_24h
    const times = samples.slice(0,200).map(s=>s.ts.split('T')[1]?s.ts.split('T')[1].replace('Z',''):s.ts);
    // filter POWER temp
    const power_t = samples.filter(s=>s.source==='POWER' && (s.parameter==='T2M' || s.parameter.includes('T'))).map(s=>s.value).reverse();
    const power_s = samples.filter(s=>s.source==='POWER' && s.parameter.includes('ALLSKY')).map(s=>s.value).reverse();
    const fire_counts = samples.filter(s=>s.source==='FIRMS' && s.parameter==='fire_count_24h').map(s=>s.value).reverse();

    // update chart datasets (simple approach: use same times for labels)
    chartAtmos.data.labels = times.reverse();
    chartAtmos.data.datasets[0].data = power_t.length?power_t:chartAtmos.data.datasets[0].data;
    chartAtmos.update();

    chartEnergy.data.labels = times.reverse();
    chartEnergy.data.datasets[0].data = power_s.length?power_s:chartEnergy.data.datasets[0].data;
    chartEnergy.update();

    chartFire.data.labels = times.reverse();
    chartFire.data.datasets[0].data = fire_counts.length?fire_counts:chartFire.data.datasets[0].data;
    chartFire.update();

    // show latest on control panel
    if(samples.length>0){
      const latest = samples[0];
      // example: display in UI - add elements or reuse infoCol fields
      // document.getElementById('someElement').textContent = ...
    }
  } catch(e){
    console.error('fetchEnv error', e);
  }
}

// call fetchEnv every 30s
fetchEnv();
setInterval(fetchEnv, 30000);
// GIBS tile example (Blue Marble / MODIS overlays). Use WMTS or TMS endpoints - example of GIBS layer:
const gibsUrl = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tileMatrixSet}/{z}/{y}/{x}.jpg";

// Example layer: MODIS_Terra_CorrectedReflectance_TrueColor
const gibsLayer = (layerName) => {
  const time = new Date().toISOString().split('T')[0];
  const url = gibsUrl.replace("{layer}", layerName)
                     .replace("{time}", time)
                     .replace("{tileMatrixSet}", "GoogleMapsCompatible_Level9");
  return L.tileLayer(url, {maxZoom:9, attribution:'NASA GIBS'});
};

const modisTrue = gibsLayer('MODIS_Terra_CorrectedReflectance_TrueColor');
const sstLayer = gibsLayer('MODIS_Aqua_Surface_Temperature'); // example
// add controls
const overlays = {"MODIS TrueColor": modisTrue, "SST": sstLayer};
L.control.layers(null, overlays).addTo(map);
// debug helpers (display raw /env JSON and allow injecting test samples)
async function fetchEnvRawAndShow(){
  try {
    const res = await fetch('/env');
    const raw = await res.text();
    // try parse JSON nicely; if fails, show raw text
    try {
      const j = JSON.parse(raw);
      document.getElementById('envDebug').textContent = 'Last /env size: ' + (j.samples? j.samples.length : '(no samples)') + ' — last fetch: ' + new Date().toISOString();
      // also show small formatted preview below
      let preview = '';
      if (j.samples && j.samples.length) {
        preview = JSON.stringify(j.samples.slice(0,6), null, 2);
      } else preview = '(no samples)';
      // append a small pre block for readability
      const prevId = 'envPreview';
      let prevEl = document.getElementById(prevId);
      if(!prevEl){ prevEl = document.createElement('pre'); prevEl.id = prevId; prevEl.style.color = '#9aa0a6'; prevEl.style.fontSize = '11px'; prevEl.style.maxHeight = '160px'; prevEl.style.overflow = 'auto'; document.getElementById('envDebug').appendChild(prevEl); }
      prevEl.textContent = preview;
    } catch(e){
      document.getElementById('envDebug').textContent = 'Invalid /env response (not JSON) — raw preview below';
      const pre = document.getElementById('envPreview') || document.createElement('pre');
      pre.id = 'envPreview'; pre.style.color = '#9aa0a6'; pre.style.fontSize = '11px'; pre.style.maxHeight = '160px'; pre.style.overflow = 'auto';
      pre.textContent = raw;
      document.getElementById('envDebug').appendChild(pre);
    }
  } catch(err){
    document.getElementById('envDebug').textContent = 'Error fetching /env: ' + String(err);
  }
}

// hook buttons
document.getElementById('injectBtn').addEventListener('click', async ()=>{
  document.getElementById('envDebug').textContent = 'Injecting test sample...';
  try {
    const res = await fetch('/env/inject-test', {method:'POST'});
    const j = await res.json();
    document.getElementById('envDebug').textContent = 'Injected: ' + j.injected;
    // refresh env and charts
    await fetchEnv();
    await fetchEnvRawAndShow();
  } catch(e){
    document.getElementById('envDebug').textContent = 'Inject failed: ' + e;
  }
});

document.getElementById('refreshEnvBtn').addEventListener('click', async ()=>{
  document.getElementById('envDebug').textContent = 'Refreshing /env...';
  await fetchEnv();       // this updates charts and envSamples
  await fetchEnvRawAndShow();
});

// call once on load
fetchEnvRawAndShow();
