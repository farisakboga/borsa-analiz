/**
 * BORSA ANALİZ - Netlify Serverless Function (Node.js)
 */

const API_KEYS = [
  "api-e2803ac4-7f7f-46ff-bc34-d0841a59d9a6",
  "api-af631297-707c-4e54-bc31-8c835e17423e",
  "api-f6623eef-d8d6-47c6-b5aa-5a91adcca25c",
  "api-3f4f112f-3059-4b23-95ab-d56f325596fc",
  "api-1929eb12-945e-4687-af2f-c792c6bef3ff",
  "api-b3b61a6d-ea0a-4ce5-8035-b1da1d17257b",
  "api-15acde44-affd-452e-8804-6c179f029db1",
  "api-7da5db22-096f-45a1-9b38-ad71bc32cee3",
  "api-19580929-cd62-46af-b406-64397af956df",
  "api-a6c60acd-5110-4be9-a2f9-da1939b103d9",
  "api-c8f4c1cc-66bf-4360-922f-5217c5f04631",
  "api-77349f47-6631-4810-9e3c-9bb0edc29172"
];

const BASE_URL = 'https://api.finfree.app/api';

const GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

function ok(data) {
  return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
}
function err(msg, code = 200) {
  return { statusCode: code, headers: CORS, body: JSON.stringify({ error: msg }) };
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function temizleSayisal(metin) {
  if (!metin) return 0.0;
  let s = String(metin).toLowerCase().trim();
  let carpan = 1.0;
  if (s.includes('mr')) carpan = 1_000_000_000;
  else if (s.includes('mn')) carpan = 1_000_000;
  s = s.replace('mntl','').replace('mrtl','').replace('mn','').replace('mr','')
       .replace('tl','').replace('%','').trim()
       .replace(/\./g,'').replace(',','.');
  const num = parseFloat(s);
  return isNaN(num) ? 0.0 : num * carpan;
}

function formatBorsaDegeri(value) {
  if (!value || value === 0) return '--';
  if (value >= 1_000_000_000) return `${(value/1_000_000_000).toFixed(1)} Mr TL`;
  if (value >= 1_000_000)     return `${(value/1_000_000).toFixed(1)} Mn TL`;
  return `${value.toFixed(0)} TL`;
}

function formatDateTR(d) {
  const day   = String(d.getDate()).padStart(2,'0');
  const month = String(d.getMonth()+1).padStart(2,'0');
  return `${day}-${month}-${d.getFullYear()}`;
}

function rollingMean(arr, window) {
  return arr.map((_, i) => {
    if (i < window - 1) return 0;
    const slice = arr.slice(i - window + 1, i + 1).filter(v => v > 0);
    if (slice.length < window / 2) return 0;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms))
  ]);
}

async function fetchIsyatirimCari(hisse) {
  try {
    const r = await fetch(`https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/sirket-karti.aspx?hisse=${hisse}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) return { cari: {}, company_name: null };
    const html = await r.text();
    const cari = {};
    let company_name = null;
    const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match) company_name = h1Match[1].replace(/<[^>]+>/g, '').trim();
    const cariSection = html.match(/Cari De[ğg]erler[\s\S]*?<table[\s\S]*?<\/table>/i);
    if (cariSection) {
      const rows = cariSection[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
      rows.forEach(row => {
        const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || [];
        if (cells.length >= 2) {
          const key = cells[0].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
          const val = cells[1].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
          if (key && val) cari[key] = val;
        }
      });
    }
    return { cari, company_name };
  } catch(e) {
    return { cari: {}, company_name: null };
  }
}

async function fetchFinfreeInfo(symbol) {
  try {
    const r = await fetch(`${BASE_URL}/v1/stock/detail?locale=tr&symbol=${symbol}&region=tr&asset_class=equity&api_key=${randomChoice(API_KEYS)}`);
    if (!r.ok) return {};
    return await r.json();
  } catch(e) { return {}; }
}

async function fetchPriceData(hisse, years = 5) {
  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - years);
  start.setDate(start.getDate() - 20);
  const url = `https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTekil?hisse=${hisse}&startdate=${formatDateTR(start)}&enddate=${formatDateTR(now)}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.value && j.value.length) ? j.value : null;
  } catch(e) { return null; }
}

async function fetchTradingviewData(symbol) {
  const columns = ["name","description","close","change","volume","market_cap_basic","price_earnings_ttm","price_book_fq","dividend_yield_recent","net_debt_fq","current_ratio_fq","return_on_equity_fq","total_revenue_ttm","net_income_ttm","enterprise_value_to_revenue_ttm","ebitda_ttm","enterprise_value_ebitda_ttm","gross_margin_ttm","operating_margin_ttm","net_margin_ttm","average_volume_10d_calc","beta_1_year","Recommend.All","Perf.W","Perf.1M","Perf.3M","Perf.YTD","Perf.Y","RSI","SMA50","SMA200"];
  const columnNames = ["Kod","Şirket","Son Fiyat","Değişim %","Hacim","Piyasa Değeri","F/K","PD/DD","Temettü Verimi %","Net Borç","Cari Oran","Özkaynak Karlılığı %","Toplam Gelir","Net Kar","FD/Satışlar","FAVÖK","FD/FAVÖK","Brüt Kar Marjı %","Faaliyet Kar Marjı %","Net Kar Marjı %","10G Ort. Hacim","Beta (1Y)","Teknik Puan","Haftalık %","Aylık %","3 Aylık %","YTD %","Yıllık %","RSI (14)","SMA 50","SMA 200"];
  try {
    const r = await fetch("https://scanner.tradingview.com/turkey/scan", {
      method: "POST",
      headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/json" },
      body: JSON.stringify({ filter: [{ left: "name", operation: "equal", right: symbol }], options: { lang: "tr" }, columns, sort: { sortBy: "name", sortOrder: "asc" }, range: [0, 1] })
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const json = await r.json();
    const dataList = json.data || [];
    if (!dataList.length) return { error: 'Veri bulunamadı' };
    const d = dataList[0].d;
    const result = {};
    columnNames.forEach((name, i) => { result[name] = i < d.length ? d[i] : null; });
    const puan = result["Teknik Puan"];
    if (puan != null) {
      if (puan > 0.5) result["Tavsiye"] = "🟢 Güçlü Al";
      else if (puan > 0.1) result["Tavsiye"] = "🟩 Al";
      else if (puan < -0.5) result["Tavsiye"] = "🔴 Güçlü Sat";
      else if (puan < -0.1) result["Tavsiye"] = "🟥 Sat";
      else result["Tavsiye"] = "⬜ Nötr";
    } else result["Tavsiye"] = "N/A";
    return result;
  } catch(e) { return { error: e.message }; }
}

async function handleAnalyze(hisse, years) {
  const [cariS, infoS, priceS] = await Promise.allSettled([
    fetchIsyatirimCari(hisse), fetchFinfreeInfo(hisse), fetchPriceData(hisse, years)
  ]);
  const { cari, company_name: isyatirimName } = cariS.status === 'fulfilled' ? cariS.value : { cari: {}, company_name: null };
  const info     = infoS.status  === 'fulfilled' ? infoS.value  : {};
  const priceRaw = priceS.status === 'fulfilled' ? priceS.value : null;

  if (!priceRaw || !priceRaw.length) return err('Fiyat verisi bulunamadı');

  const sorted = [...priceRaw].sort((a, b) => {
    const [d1,m1,y1] = a.HGDG_TARIH.split('-');
    const [d2,m2,y2] = b.HGDG_TARIH.split('-');
    return new Date(`${y1}-${m1}-${d1}`).getTime() - new Date(`${y2}-${m2}-${d2}`).getTime();
  });
  const dates  = sorted.map(r => { const [d,m,y]=r.HGDG_TARIH.split('-'); return `${y}-${m}-${d}`; });
  const prices = sorted.map(r => parseFloat(r.HGDG_KAPANIS) || 0);
  const ma50   = rollingMean(prices, 50);
  const ma200  = rollingMean(prices, 200);
  const lastPrice = prices[prices.length - 1];

  let dailyChangeHtml = '--';
  if (prices.length >= 2) {
    const prev = prices[prices.length - 2];
    if (prev > 0) {
      const chg = ((lastPrice - prev) / prev) * 100;
      const cls = chg > 0 ? 'val-pos' : (chg < 0 ? 'val-neg' : '');
      const pfx = chg > 0 ? '+' : '';
      dailyChangeHtml = cls ? `<span class="${cls}">${pfx}%${chg.toFixed(2)}</span>` : `<span>%${chg.toFixed(2)}</span>`;
    }
  }

  let fullName = (info.title || isyatirimName || hisse);
  if (typeof fullName === 'string') fullName = fullName.split('|')[0].replace('Hisse Senedi','').replace('Hisse','').trim();

  let borsaDegeriStr = '--';
  try {
    const pdKey  = Object.keys(cari).find(k => k.includes('Piyasa Değeri'));
    const haoKey = Object.keys(cari).find(k => k.includes('Halka Açıklık'));
    const pdVal  = pdKey  ? temizleSayisal(cari[pdKey])  : 0;
    const hao    = haoKey ? temizleSayisal(cari[haoKey]) : 0;
    if (pdVal > 0 && hao > 0) borsaDegeriStr = formatBorsaDegeri(pdVal * (hao / 100));
  } catch(e) {}

  const cariList = [];
  let limit = 0;
  for (const [k, v] of Object.entries(cari)) {
    if (k.includes('Hacim') || k.includes('Borsa Değeri')) continue;
    if (limit > 8) break;
    cariList.push({ key: k.replace(' (TL)', '').replace('Oranı', '').trim(), value: v });
    limit++;
  }
  cariList.push({ key: 'H.A. Borsa Değeri', value: borsaDegeriStr });
  cariList.push({ key: 'Değişim', value: dailyChangeHtml });

  return ok({ chart: { dates, prices, ma50, ma200, last_price: lastPrice }, cari: cariList, desc: info.description || 'Şirket açıklaması bulunamadı.', symbol: hisse, company_name: fullName });
}

async function handleAnalyzeUsd(hisse, years) {
  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - years);
  start.setDate(start.getDate() - 20);
  try {
    const r = await fetch(`https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTekil?hisse=${hisse}&startdate=${formatDateTR(start)}&enddate=${formatDateTR(now)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return err('Veri çekilemedi');
    const j = await r.json();
    if (!j.value || !j.value.length) return err('Dolar bazlı veri bulunamadı');
    const sorted = [...j.value].filter(r => r.DOLAR_BAZLI_FIYAT != null).sort((a, b) => {
      const [d1,m1,y1] = a.HGDG_TARIH.split('-');
      const [d2,m2,y2] = b.HGDG_TARIH.split('-');
      return new Date(`${y1}-${m1}-${d1}`).getTime() - new Date(`${y2}-${m2}-${d2}`).getTime();
    });
    if (!sorted.length) return err('Dolar bazlı veri boş');
    const dates  = sorted.map(r => { const [d,m,y]=r.HGDG_TARIH.split('-'); return `${y}-${m}-${d}`; });
    const prices = sorted.map(r => parseFloat(r.DOLAR_BAZLI_FIYAT) || 0);
    return ok({ chart: { dates, prices, ma50: rollingMean(prices,50), ma200: rollingMean(prices,200), last_price: prices[prices.length-1] } });
  } catch(e) { return err(e.message); }
}

async function handleAiAnalyze(s, geminiApiKey) {
  if (!geminiApiKey) return err('GEMINI_API_KEY ayarlanmamış');
  const [cariS, infoS, tvS] = await Promise.allSettled([fetchIsyatirimCari(s), fetchFinfreeInfo(s), fetchTradingviewData(s)]);
  const { cari } = cariS.status === 'fulfilled' ? cariS.value : { cari: {} };
  const info = infoS.status === 'fulfilled' ? infoS.value : {};
  const tv   = tvS.status   === 'fulfilled' ? tvS.value   : null;
  const companyName = (info.title || s).split('|')[0].replace('Hisse Senedi','').trim();
  const tvSummary = {};
  if (tv && !tv.error) {
    ['Son Fiyat','Değişim %','F/K','PD/DD','FD/FAVÖK','Net Kar Marjı %','Özkaynak Karlılığı %','Temettü Verimi %','RSI (14)','Tavsiye','Haftalık %','Aylık %','Yıllık %','Piyasa Değeri','Net Borç','Cari Oran']
      .forEach(k => { if (tv[k] != null) tvSummary[k] = tv[k]; });
  }
  const prompt = `Sen bir küçük borsa yatırımcısısın. ${s} (${companyName}) hissesine ait bilgileri başlıklar oluşturarak derle.\n\nCARİ DEĞERLER:\n${JSON.stringify(Object.fromEntries(Object.entries(cari).slice(0,12)), null, 0)}\n\nTEKNİK & FİNANSAL:\n${JSON.stringify(tvSummary, null, 0)}\n\nŞİRKET AÇIKLAMASI: ${(info.description||'').slice(0,400)}\n\n- Genel bilgi (kuruluş, merkez, hissedarlar)\n- Finansal oranlar (F/K, PD/DD vb.)\n- Sektördeki rakipler\n- Temettü geçmişi\n- Analist hedef fiyatları\nTürkçe yaz.`;
  let lastError = 'Tüm modeller başarısız';
  for (const modelName of GEMINI_MODELS) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const result = await resp.json();
      if (result.error) { lastError = `${modelName}: ${result.error.message}`; continue; }
      if (!result.candidates?.length) { lastError = `${modelName}: Boş yanıt`; continue; }
      return ok({ analysis: result.candidates[0].content.parts[0].text, symbol: s, company: companyName, model: modelName });
    } catch(e) { lastError = `${modelName}: ${e.message}`; }
  }
  return err(lastError);
}

async function fetchYahooRaw(symbol, years) {
  const now = new Date();
  const endTs = Math.floor(now.getTime() / 1000);
  const startDate = new Date(now);
  startDate.setFullYear(startDate.getFullYear() - years);
  startDate.setDate(startDate.getDate() - 20);
  const startTs = Math.floor(startDate.getTime() / 1000);
  const qs = `interval=1d&period1=${startTs}&period2=${endTs}`;
  for (const host of ['query1', 'query2']) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      if (!r.ok) continue;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res?.timestamp?.length) continue;
      return { timestamps: res.timestamp, closes: res.indicators?.quote?.[0]?.close || [] };
    } catch(e) {}
  }
  return null;
}

async function handleGold(years) {
  const errors = [];
  try {
    const raw = await withTimeout(fetchYahooRaw('GLDTRY.IS', years), 5000);
    if (raw) {
      const dates=[], prices=[];
      for (let i=0; i<raw.timestamps.length; i++) {
        if (raw.closes[i]==null) continue;
        dates.push(new Date(raw.timestamps[i]*1000).toISOString().slice(0,10));
        prices.push(parseFloat(raw.closes[i].toFixed(4)));
      }
      if (dates.length) return ok({ dates, prices, symbol: 'GLDTRY.IS', source: 'yahoo-GLDTRY' });
    }
  } catch(e) { errors.push(e.message); }

  try {
    const [goldRaw, usdRaw] = await withTimeout(Promise.all([fetchYahooRaw('GC=F', years), fetchYahooRaw('USDTRY=X', years)]), 7000);
    if (goldRaw && usdRaw) {
      const usdMap = {};
      for (let i=0; i<usdRaw.timestamps.length; i++) {
        if (usdRaw.closes[i]==null) continue;
        usdMap[new Date(usdRaw.timestamps[i]*1000).toISOString().slice(0,10)] = usdRaw.closes[i];
      }
      const sortedDates = Object.keys(usdMap).sort();
      const getUsd = d => { if (usdMap[d]) return usdMap[d]; for (let i=sortedDates.length-1;i>=0;i--) { if (sortedDates[i]<=d) return usdMap[sortedDates[i]]; } return null; };
      const dates=[], prices=[];
      for (let i=0; i<goldRaw.timestamps.length; i++) {
        if (goldRaw.closes[i]==null) continue;
        const d = new Date(goldRaw.timestamps[i]*1000).toISOString().slice(0,10);
        const u = getUsd(d);
        if (!u) continue;
        dates.push(d);
        prices.push(parseFloat(((goldRaw.closes[i]/31.1035)*u).toFixed(4)));
      }
      if (dates.length) return ok({ dates, prices, symbol: 'GC=F_TL', source: 'yahoo-GCF' });
    }
  } catch(e) { errors.push(e.message); }

  try {
    const now = new Date();
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - years);
    start.setDate(start.getDate() - 20);
    const r = await withTimeout(fetch(`https://www.isyatirim.com.tr/_Layouts/15/IsYatirim.Website/Common/Data.aspx/HisseTekil?hisse=ALTIN&startdate=${formatDateTR(start)}&enddate=${formatDateTR(now)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }), 5000);
    if (r.ok) {
      const j = await r.json();
      if (j.value?.length) {
        const sorted = [...j.value].sort((a,b) => { const [d1,m1,y1]=a.HGDG_TARIH.split('-'); const [d2,m2,y2]=b.HGDG_TARIH.split('-'); return new Date(`${y1}-${m1}-${d1}`)-new Date(`${y2}-${m2}-${d2}`); });
        const dates=[], prices=[];
        for (const row of sorted) { if (!row.HGDG_KAPANIS) continue; const [d,m,y]=row.HGDG_TARIH.split('-'); dates.push(`${y}-${m}-${d}`); prices.push(parseFloat(row.HGDG_KAPANIS)||0); }
        if (dates.length) return ok({ dates, prices, symbol: 'ALTIN', source: 'isyatirim' });
      }
    }
  } catch(e) { errors.push(e.message); }

  return err(`Altın verisi alınamadı: ${errors.join(' | ')}`);
}

async function handleUsdTry(years) {
  try {
    const raw = await withTimeout(fetchYahooRaw('USDTRY=X', years), 5000);
    if (!raw) return err('USDTRY verisi alınamadı');
    const dates=[], prices=[];
    for (let i=0; i<raw.timestamps.length; i++) {
      if (raw.closes[i]==null) continue;
      dates.push(new Date(raw.timestamps[i]*1000).toISOString().slice(0,10));
      prices.push(parseFloat(raw.closes[i].toFixed(4)));
    }
    return ok({ dates, prices });
  } catch(e) { return err('USDTRY verisi alınamadı'); }
}

// ─── ANA HANDLER ──────────────────────────────────────────────────────────────
exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // /api/analyze → path içinden endpoint'i çıkar
  const path = (event.path || '').replace('/.netlify/functions/api', '').replace('/api', '') || '/';
  const params = event.queryStringParameters || {};
  const geminiKey = process.env.GEMINI_API_KEY || '';

  const getS = () => (params.s || '').toUpperCase().trim();
  const getYears = (def=5) => Math.min(25, Math.max(1, parseInt(params.years || def) || def));

  if (path === '/analyze') {
    const s = getS(); if (!s) return err('Sembol yok');
    return await handleAnalyze(s, getYears(10));
  }
  if (path === '/analyze_usd') {
    const s = getS(); if (!s) return err('Sembol yok');
    return await handleAnalyzeUsd(s, getYears(5));
  }
  if (path === '/tvdata') {
    const s = getS(); if (!s) return err('Sembol yok');
    return ok(await fetchTradingviewData(s));
  }
  if (path === '/ai_analyze') {
    const s = getS(); if (!s) return err('Sembol yok');
    return await handleAiAnalyze(s, geminiKey);
  }
  if (path === '/prefetch') return ok({ status: 'ok' });
  if (path === '/gold') return await handleGold(getYears(5));
  if (path === '/usdtry') return await handleUsdTry(getYears(10));
  if (path === '/health') return ok({ status: 'ok', ts: new Date().toISOString() });

  return err('Bilinmeyen endpoint: ' + path, 404);
};
