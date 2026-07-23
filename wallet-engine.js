/* ═══════════════════════════════════════════════════════════════════
   WALLET ENGINE v17 — Seed/Key Auth + Cloud Sync + Blockchain + PIN + On-chain Txs
   ═══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

var BOT_RPC = 'https://rpc.bohr.life';
var BOT_CHAIN_ID = 968;
var BOT_CHAIN_HEX = '0x3C8';
var BOT_EXPLORER = 'https://scan.bohr.life';
var SBT_ADDRESS = '0x740e1ce98364EfF4d5e3d89b2b1fa513e0F75b16';
var SBT_ABI = [
  'function mintSoulboundGift(address _recipient, string _tokenURI, string _message) payable returns (uint256)',
  'function convertToBot(uint256 _tokenId) nonpayable',
  'function getGiftData(uint256 _tokenId) view returns (address sender, address recipient, string message, uint256 amount, uint256 timestamp)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenCounter() view returns (uint256)',
  'event SoulboundGiftMinted(uint256 indexed tokenId, address indexed sender, address indexed recipient, string tokenURI, uint256 amount)',
  'event GiftConverted(uint256 indexed tokenId, address indexed recipient, uint256 amount)'
];
var COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,ripple,wrapped-bot&vs_currencies=usd&include_24hr_change=true';
var BOT_PRICE_USD = 0;
var STORAGE_KEY = 'archon_wallet_v1';
var PROFILE_KEY = 'archon_profile_v1';
var TX_HISTORY_KEY = 'archon_tx_history';
var GIFT_CODES_KEY = 'archon_gift_codes';
var POINTS_KEY = 'archon_points';

var SUPABASE_URL = 'https://vjljoydtwvpvhqiecbqr.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqbGpveWR0d3ZwdmhxaWVjYnFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3OTAwMjYsImV4cCI6MjA5OTM2NjAyNn0.YFIbiUGGzGvjuvF2bsm4dQv_yzNtJr8G1La8Rtqexy8';
var sbClient = null;

var provider = null;
var wallet = null;
var sbtContract = null;
var walletData = null;
var _seedHash = null;

function $(id){ return document.getElementById(id); }
window._cx$ = $;
function shortAddr(a){ return a ? a.slice(0,6)+'...'+a.slice(-4) : ''; }
function fmt(n){ return Number(n).toLocaleString('en-US',{maximumFractionDigits:6}); }

function extractError(err){
  if(!err) return 'Unknown error';
  if(typeof err === 'string') return err;
  if(err.message) return err.message;
  if(err.error_description) return err.error_description;
  if(err.msg) return err.msg;
  try { return JSON.stringify(err); } catch(e){ return 'Unknown error'; }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 1: SUPABASE CLIENT INIT
   ═══════════════════════════════════════════════════════════════════ */
function initSupabase(){
  if(typeof window.supabase !== 'undefined' && !sbClient){
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('[Archon] Supabase client initialized');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 2: HASHING UTILITIES
   ═══════════════════════════════════════════════════════════════════ */
async function hashString(str){
  var enc = new TextEncoder();
  var hash = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return Array.from(new Uint8Array(hash)).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
}

async function getSeedHash(mnemonic){
  return await hashString('archon-seed-' + mnemonic.replace(/\s+/g, ' ').trim().toLowerCase());
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 3: RECOVERY KEY GENERATION
   ═══════════════════════════════════════════════════════════════════ */
function generateRecoveryKey(){
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var raw = '';
  for(var i = 0; i < 16; i++){
    raw += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return raw;
}
function formatRecoveryKey(key){
  return key.match(/.{1,4}/g).join('-');
}
function normalizeRecoveryKey(input){
  return input.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function saveRecoveryKey(key){
  localStorage.setItem('archon_recovery_key', key);
  autoSyncCloud();
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 3B: DEVICE PIN LOCK
   ═══════════════════════════════════════════════════════════════════ */
function setPin(pin){
  localStorage.setItem('archon_device_pin', pin);
  localStorage.setItem('archon_pin_enabled', '1');
}
function getPin(){
  return localStorage.getItem('archon_device_pin');
}
function isPinSet(){
  return localStorage.getItem('archon_pin_enabled') === '1' && !!localStorage.getItem('archon_device_pin');
}
function verifyPin(pin){
  return pin === localStorage.getItem('archon_device_pin');
}
function clearPin(){
  localStorage.removeItem('archon_device_pin');
  localStorage.removeItem('archon_pin_enabled');
}
function setPinEnabled(enabled){
  if(enabled) localStorage.setItem('archon_pin_enabled', '1');
  else localStorage.setItem('archon_pin_enabled', '0');
}
function isPinEnabled(){
  return localStorage.getItem('archon_pin_enabled') !== '0';
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 4: ENCRYPTION — AES-256-GCM
   ═══════════════════════════════════════════════════════════════════ */
async function deriveKey(password, salt){
  var enc = new TextEncoder();
  var keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(plaintext, password){
  var enc = new TextEncoder();
  var salt = 'archon-v15-' + password.slice(0,8);
  var key = await deriveKey(password, salt);
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(plaintext));
  var combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode.apply(null, combined));
}

async function decryptText(encoded, password){
  try {
    var raw = atob(encoded);
    var bytes = new Uint8Array(raw.length);
    for(var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var iv = bytes.slice(0, 12);
    var ciphertext = bytes.slice(12);
    var salt = 'archon-v15-' + password.slice(0,8);
    var key = await deriveKey(password, salt);
    var decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch(e){
    throw new Error('Decryption failed — wrong key or corrupted data');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 5: CLOUD SYNC — SAVE WALLET (seed-hash keyed)
   ═══════════════════════════════════════════════════════════════════ */
async function saveWalletToCloud(){
  initSupabase();
  if(!sbClient || !walletData) { console.log('[Archon] No wallet — skipping cloud save'); return false; }
  if(!walletData.mnemonic) { console.log('[Archon] No seed phrase — skipping cloud save'); return false; }
  try {
    var seedHash = await getSeedHash(walletData.mnemonic);
    var seedEnc = await encryptText(walletData.mnemonic, walletData.mnemonic);
    var pkEnc = await encryptText(walletData.privateKey, walletData.mnemonic);
    var recoveryKeyRaw = localStorage.getItem('archon_recovery_key');
    var recoveryKeyHash = null;
    var seedEncRK = null;
    var pkEncRK = null;
    if(recoveryKeyRaw){
      var cleanRK = normalizeRecoveryKey(recoveryKeyRaw);
      var rkPassword = 'archon-recovery-' + cleanRK;
      recoveryKeyHash = await hashString(cleanRK);
      seedEncRK = await encryptText(walletData.mnemonic, rkPassword);
      pkEncRK = await encryptText(walletData.privateKey, rkPassword);
    }
    var profileData = getProfile() || {};
    var txData = getTxHistory();
    var giftData = getGiftCodes();
    var pointsVal = getPoints();
    var row = {
      seed_hash: seedHash,
      recovery_key_hash: recoveryKeyHash,
      wallet_address: walletData.address,
      encrypted_seed: seedEnc,
      encrypted_pk: pkEnc,
      encrypted_seed_rk: seedEncRK,
      encrypted_pk_rk: pkEncRK,
      profile: profileData,
      tx_history: txData,
      gift_codes: giftData,
      points: pointsVal,
      updated_at: new Date().toISOString()
    };
    var { data, error } = await sbClient
      .from('wallets')
      .upsert(row, { onConflict: 'seed_hash' });
    if(error) throw new Error(extractError(error));
    console.log('[Archon] Wallet saved to cloud');
    return true;
  } catch(e){
    console.error('[Archon] Cloud save failed', e);
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 6: CLOUD SYNC — RESTORE BY SEED PHRASE
   ═══════════════════════════════════════════════════════════════════ */
async function restoreFromSeed(mnemonic){
  initSupabase();
  if(!sbClient) throw new Error('Supabase not loaded');
  if(!mnemonic || !mnemonic.trim()) throw new Error('Enter your seed phrase');
  try {
    var seedHash = await getSeedHash(mnemonic);
    var { data, error } = await sbClient
      .from('wallets')
      .select('*')
      .eq('seed_hash', seedHash)
      .single();
    if(error || !data) throw new Error('No wallet found with this seed phrase');
    var seedPhrase = await decryptText(data.encrypted_seed, mnemonic);
    var privateKey = await decryptText(data.encrypted_pk, mnemonic);
    walletData = { address: data.wallet_address, privateKey: privateKey, mnemonic: seedPhrase, createdAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
    if(data.profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(data.profile));
    if(data.tx_history && data.tx_history.length) localStorage.setItem(TX_HISTORY_KEY, JSON.stringify(data.tx_history));
    if(data.gift_codes && Object.keys(data.gift_codes).length) localStorage.setItem(GIFT_CODES_KEY, JSON.stringify(data.gift_codes));
    if(data.points) localStorage.setItem(POINTS_KEY, String(data.points));
    initProvider();
    console.log('[Archon] Wallet restored from seed:', walletData.address);
    return walletData;
  } catch(e){
    throw new Error(extractError(e));
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 7: CLOUD SYNC — RESTORE BY RECOVERY KEY
   ═══════════════════════════════════════════════════════════════════ */
async function restoreFromKey(recoveryKey){
  initSupabase();
  if(!sbClient) throw new Error('Supabase not loaded');
  try {
    var cleanKey = normalizeRecoveryKey(recoveryKey);
    if(cleanKey.length !== 16) throw new Error('Security key must be 16 characters');
    var keyHash = await hashString(cleanKey);
    var { data, error } = await sbClient
      .from('wallets')
      .select('*')
      .eq('recovery_key_hash', keyHash)
      .single();
    if(error || !data) throw new Error('No wallet found with this security key');
    var encKey = 'archon-recovery-' + cleanKey;
    var seedPhrase, privateKey;
    if(data.encrypted_seed_rk && data.encrypted_pk_rk){
      seedPhrase = await decryptText(data.encrypted_seed_rk, encKey);
      privateKey = await decryptText(data.encrypted_pk_rk, encKey);
    } else {
      seedPhrase = await decryptText(data.encrypted_seed, encKey);
      privateKey = await decryptText(data.encrypted_pk, encKey);
    }
    walletData = { address: data.wallet_address, privateKey: privateKey, mnemonic: seedPhrase, createdAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
    localStorage.setItem('archon_recovery_key', recoveryKey);
    if(data.profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(data.profile));
    if(data.tx_history && data.tx_history.length) localStorage.setItem(TX_HISTORY_KEY, JSON.stringify(data.tx_history));
    if(data.gift_codes && Object.keys(data.gift_codes).length) localStorage.setItem(GIFT_CODES_KEY, JSON.stringify(data.gift_codes));
    if(data.points) localStorage.setItem(POINTS_KEY, String(data.points));
    initProvider();
    console.log('[Archon] Wallet restored from key:', walletData.address);
    return walletData;
  } catch(e){
    throw new Error(extractError(e));
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 8: CLOUD SYNC — AUTO-SYNC (debounced)
   ═══════════════════════════════════════════════════════════════════ */
var _syncTimer = null;
function autoSyncCloud(){
  if(_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(function(){
    saveWalletToCloud().catch(function(e){});
  }, 3000);
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 9: WALLET CREATION / LOADING
   ═══════════════════════════════════════════════════════════════════ */
function loadWallet(){
  try { var raw = localStorage.getItem(STORAGE_KEY); if(raw){ walletData = JSON.parse(raw); return true; } } catch(e){}
  return false;
}
function createWallet(){
  if(typeof ethers === 'undefined') throw new Error('ethers.js not loaded');
  var w = ethers.Wallet.createRandom();
  walletData = { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic.phrase, createdAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
  initProvider();
  return walletData;
}
function initProvider(){
  if(!walletData) return;
  try {
    provider = new ethers.JsonRpcProvider(BOT_RPC, BOT_CHAIN_ID);
    wallet = new ethers.Wallet(walletData.privateKey, provider);
    sbtContract = new ethers.Contract(SBT_ADDRESS, SBT_ABI, wallet);
  } catch(e){ console.error('[Archon] init error', e); }
}
function logoutWallet(){
  walletData = null; wallet = null; provider = null; sbtContract = null;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(TX_HISTORY_KEY);
  localStorage.removeItem(GIFT_CODES_KEY);
  localStorage.removeItem(POINTS_KEY);
  localStorage.removeItem('archon_recovery_key');
  _seedHash = null;
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 10: TX HISTORY
   ═══════════════════════════════════════════════════════════════════ */
function getTxHistory(){
  try { var raw = localStorage.getItem(TX_HISTORY_KEY); if(raw) return JSON.parse(raw); } catch(e){}
  return [];
}
function addTx(tx){
  var list = getTxHistory();
  tx.id = Date.now()+'-'+Math.random().toString(36).slice(2,6);
  tx.timestamp = tx.timestamp || Date.now();
  list.unshift(tx);
  if(list.length > 100) list = list.slice(0,100);
  localStorage.setItem(TX_HISTORY_KEY, JSON.stringify(list));
  autoSyncCloud();
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 10B: ON-CHAIN TX HISTORY FETCHING
   ═══════════════════════════════════════════════════════════════════ */
async function fetchOnChainTransactions(){
  if(!walletData || !walletData.address) return [];
  var addr = walletData.address;
  var explorerApi = BOT_EXPLORER + '/api';
  try {
    var resp = await fetch(explorerApi + '?module=account&action=txlist&address=' + addr + '&startblock=0&endblock=99999999&sort=desc&page=1&offset=50');
    var data = await resp.json();
    if(data.status === '1' && data.result && data.result.length){
      var txs = [];
      for(var i = 0; i < data.result.length; i++){
        var raw = data.result[i];
        var isIncoming = raw.to && raw.to.toLowerCase() === addr.toLowerCase();
        var amount = parseFloat(ethers.formatEther(raw.value || '0'));
        if(amount === 0 && !isIncoming) continue;
        txs.push({
          type: isIncoming ? 'receive' : 'send',
          amount: amount,
          token: 'BOT',
          to: raw.to,
          from: raw.from,
          hash: raw.hash,
          timestamp: parseInt(raw.timeStamp) * 1000,
          status: raw.isError === '0' ? 'confirmed' : 'failed',
          gasUsed: raw.gasUsed ? parseFloat(ethers.formatEther(BigInt(raw.gasUsed) * BigInt(raw.gasPrice || '1000000000'))).toFixed(6) : null,
          source: 'onchain'
        });
      }
      return txs;
    }
  } catch(e){ console.log('[Archon] Explorer API unavailable, using local history'); }
  return [];
}

async function fetchGiftActivity(){
  if(!walletData || !walletData.address) return {sent: 0, received: 0, activities: []};
  var sent = 0, received = 0, activities = [];
  try {
    if(sbtContract){
      var counter = await sbtContract.tokenCounter();
      var count = parseInt(counter.toString());
      for(var i = 1; i <= count && i <= 100; i++){
        try {
          var data = await sbtContract.getGiftData(i);
          var owner = await sbtContract.ownerOf(i);
          var amt = parseFloat(ethers.formatEther(data.amount));
          if(data.sender.toLowerCase() === walletData.address.toLowerCase()){
            sent++;
            activities.push({type:'sent', tokenId: i, amount: amt, to: data.recipient, message: data.message, timestamp: Number(data.timestamp)*1000});
          }
          if(data.recipient.toLowerCase() === walletData.address.toLowerCase()){
            received++;
            activities.push({type:'received', tokenId: i, amount: amt, from: data.sender, message: data.message, timestamp: Number(data.timestamp)*1000});
          }
        } catch(e){}
      }
    }
  } catch(e){ console.log('[Archon] Gift scan error', e); }
  return {sent: sent, received: received, activities: activities};
}

async function refreshAllData(){
  if(!walletData) return;
  try {
    await fetchAllBalances();
    var localTxs = getTxHistory();
    var onchainTxs = await fetchOnChainTransactions();
    var merged = {};
    for(var i = 0; i < localTxs.length; i++){
      if(localTxs[i].hash) merged[localTxs[i].hash] = localTxs[i];
    }
    for(var i = 0; i < onchainTxs.length; i++){
      if(!merged[onchainTxs[i].hash]) merged[onchainTxs[i].hash] = onchainTxs[i];
    }
    var allTxs = Object.values(merged).sort(function(a,b){ return (b.timestamp||0) - (a.timestamp||0); });
    localStorage.setItem(TX_HISTORY_KEY, JSON.stringify(allTxs.slice(0,100)));
    var giftData = await fetchGiftActivity();
    localStorage.setItem('archon_gift_sent_count', String(giftData.sent));
    localStorage.setItem('archon_gift_received_count', String(giftData.received));
    localStorage.setItem('archon_gift_activities', JSON.stringify(giftData.activities));
    syncBalanceToUI(parseFloat(lastKnownBalance) || 0);
    if(typeof renderTxHistory === 'function') renderTxHistory();
    if(typeof updateGiftStats === 'function') updateGiftStats();
    if(typeof renderDashboardBalance === 'function') renderDashboardBalance();
    if(typeof updateWalletPocket === 'function') updateWalletPocket();
  } catch(e){ console.error('[Archon] refresh error', e); }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 11: GIFT CODE MAPPING
   ═══════════════════════════════════════════════════════════════════ */
function getGiftCodes(){
  try { var raw = localStorage.getItem(GIFT_CODES_KEY); if(raw) return JSON.parse(raw); } catch(e){}
  return {};
}
function saveGiftCode(code, tokenId, amount, recipient){
  var map = getGiftCodes();
  map[code] = { tokenId: tokenId, amount: amount, recipient: recipient, createdAt: Date.now() };
  localStorage.setItem(GIFT_CODES_KEY, JSON.stringify(map));
  autoSyncCloud();
}
function lookupGiftCode(code){
  var map = getGiftCodes();
  return map[code] || null;
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 12: POINTS
   ═══════════════════════════════════════════════════════════════════ */
function getPoints(){
  try { return parseInt(localStorage.getItem(POINTS_KEY)) || 0; } catch(e){ return 0; }
}
function addPoints(n){
  var p = getPoints() + n;
  localStorage.setItem(POINTS_KEY, String(p));
  autoSyncCloud();
  return p;
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 13: BALANCE FETCHING
   ═══════════════════════════════════════════════════════════════════ */
async function fetchBOTBalance(){
  if(!provider || !walletData) return '0';
  try { var bal = await provider.getBalance(walletData.address); return ethers.formatEther(bal); }
  catch(e){ console.error('[Archon] balance error', e); return '0'; }
}
function syncBalanceToUI(n){
  var priceUsd = BOT_PRICE_USD;
  var usdVal = n * priceUsd;
  var balStr = n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  var usdStr = usdVal.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  var priceStr = priceUsd > 0 ? priceUsd.toLocaleString('en-US') : '0';
  if(typeof window.cxTOKENS!=='undefined'){ for(var i=0;i<window.cxTOKENS.length;i++){ if(window.cxTOKENS[i].id==='BOT'){ window.cxTOKENS[i].bal=n; if(priceUsd>0) window.cxTOKENS[i].price=priceUsd; } } }
  if(typeof chainDatabase!=='undefined' && chainDatabase.bot){
    chainDatabase.bot.balance = balStr;
    chainDatabase.bot.usdBalance = usdStr;
    chainDatabase.bot.addr = walletData?walletData.address:chainDatabase.bot.addr;
    if(priceUsd>0) chainDatabase.bot.price = priceStr;
    if(chainDatabase.bot.tokens&&chainDatabase.bot.tokens[0]){
      chainDatabase.bot.tokens[0].bal = balStr;
      chainDatabase.bot.tokens[0].usd = '$'+usdStr;
    }
  }
  if(typeof GVT!=='undefined'){ for(var i=0;i<GVT.length;i++){ if(GVT[i].sym==='$BOT'||GVT[i].sym==='BOT'){ GVT[i].bal=n; if(priceUsd>0) GVT[i].price=priceUsd; } } }
  if(typeof tokenDetails!=='undefined' && tokenDetails.BOT){
    tokenDetails.BOT.bal = balStr;
    if(priceUsd>0) tokenDetails.BOT.price = '$'+priceStr;
  }
  if(typeof window.cxS!=='undefined') window.cxS.wdFee = 0.001;
  if(typeof updateWalletPocket==='function') updateWalletPocket();
  if(typeof renderDashboardBalance==='function') renderDashboardBalance();
  var el;
  el = document.getElementById('wpcBotBal'); if(el) el.textContent = balStr + ' BOT';
  el = document.getElementById('wpcTotalUsd'); if(el) el.textContent = '$' + usdStr;
  el = document.getElementById('wdbalETH'); if(el) el.textContent = balStr + ' BOT';
  el = document.getElementById('cxSendPrice'); if(el) el.textContent = '$' + usdStr;
  el = document.getElementById('gvBalHint'); if(el) el.textContent = 'Balance: ' + balStr + ' BOT';
}
var lastKnownBalance = '0';
async function fetchAllBalances(){
  var botBal = await fetchBOTBalance();
  var n = parseFloat(botBal) || 0;
  var prev = parseFloat(lastKnownBalance) || 0;
  if(prev > 0 && n > prev && (n - prev) > 0.0001){
    var diff = (n - prev).toFixed(4);
    if(typeof showDepositNotif==='function') showDepositNotif(diff, walletData?walletData.address:null);
  }
  lastKnownBalance = botBal;
  syncBalanceToUI(n);
  if(typeof renderDashboardBalance==='function') renderDashboardBalance();
  return botBal;
}
function renderDashboardBalance(){
  if(!walletData) return;
  var n = 0;
  if(typeof chainDatabase!=='undefined' && chainDatabase.bot){
    n = parseFloat(chainDatabase.bot.balance) || 0;
  }
  var priceUsd = BOT_PRICE_USD;
  var usdVal = (n * priceUsd).toFixed(2);
  if(typeof updateWalletPocket==='function') updateWalletPocket();
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 14: GAS ESTIMATION
   ═══════════════════════════════════════════════════════════════════ */
async function estimateGasFee(toAddress, amountEth){
  if(!provider || !wallet) return { gasLimit: '21000', gasPrice: '0', feeBot: '0', feeUsd: '$0.00' };
  try {
    var amountWei = ethers.parseEther(amountEth.toString());
    var tx = { from: wallet.address, to: toAddress, value: amountWei };
    var gasEstimate = await provider.estimateGas(tx);
    var feeData = await provider.getFeeData();
    var gasPrice = feeData.gasPrice || ethers.parseUnits('1','gwei');
    var totalFee = gasEstimate * gasPrice;
    var feeBot = parseFloat(ethers.formatEther(totalFee));
    var feeUsd = (feeBot * BOT_PRICE_USD).toFixed(4);
    return {
      gasLimit: gasEstimate.toString(),
      gasPrice: ethers.formatUnits(gasPrice, 'gwei'),
      feeBot: feeBot.toFixed(6),
      feeUsd: '$' + feeUsd
    };
  } catch(e){
    console.error('[Archon] gas estimate error', e);
    return { gasLimit: '21000', gasPrice: '1', feeBot: '0.000021', feeUsd: '$0.00' };
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 15: COINGECKO PRICE FETCHING
   ═══════════════════════════════════════════════════════════════════ */
async function fetchPrices(){
  try {
    var resp = await fetch(COINGECKO_URL);
    var data = await resp.json();
    var map = { ETH: data.ethereum, BTC: data.bitcoin, SOL: data.solana, BNB: data.binancecoin, XRP: data.ripple, BOT: data['wrapped-bot'] };
    if(map.BOT && map.BOT.usd){
      BOT_PRICE_USD = map.BOT.usd;
      var p = map.BOT.usd.toLocaleString('en-US');
      var ch = map.BOT.usd_24h_change;
      var chStr = ch != null ? (ch>0?'+':'')+ch.toFixed(2)+'%' : '—';
      var dir = ch != null ? (ch>0?'up':'down') : 'neutral';
      if(typeof chartData !== 'undefined'){
        chartData['1H'].val = p; chartData['1D'].val = p; chartData['1W'].val = p;
        chartData['1H'].chg = chStr; chartData['1D'].chg = chStr; chartData['1W'].chg = chStr;
        chartData['1H'].dir = dir; chartData['1D'].dir = dir; chartData['1W'].dir = dir;
      }
      if(typeof chainMap !== 'undefined' && chainMap.bot){
        chainMap.bot.prices['1H'] = p; chainMap.bot.prices['1D'] = p; chainMap.bot.prices['1W'] = p;
        chainMap.bot.chgs['1H'] = chStr; chainMap.bot.chgs['1D'] = chStr; chainMap.bot.chgs['1W'] = chStr;
        chainMap.bot.dirs['1H'] = dir; chainMap.bot.dirs['1D'] = dir; chainMap.bot.dirs['1W'] = dir;
      }
    }
    if(window.cxTOKENS){ for(var i=0;i<window.cxTOKENS.length;i++){ var t=window.cxTOKENS[i]; if(map[t.id]&&map[t.id].usd) t.price=map[t.id].usd; } }
    if(window.GVT){ for(var i=0;i<window.GVT.length;i++){ var s=window.GVT[i].sym.replace('\\$',''); if(map[s]&&map[s].usd){ window.GVT[i].price=map[s].usd; } } }
    if(typeof chainDatabase!=='undefined'){
      var pairs=[['ETH','eth'],['BTC','btc'],['SOL','sol'],['BNB','bnb'],['XRP','xrp']];
      for(var p=0;p<pairs.length;p++){ var cg=pairs[p][0],db=pairs[p][1];
        if(map[cg]&&map[cg].usd){ chainDatabase[db].price=map[cg].usd.toLocaleString('en-US');
          if(map[cg].usd_24h_change!=null){ chainDatabase[db].change24h=(map[cg].usd_24h_change>0?'+':'')+map[cg].usd_24h_change.toFixed(2)+'%'; chainDatabase[db].changeDir=map[cg].usd_24h_change>0?'up':'down'; }
        }
      }
      if(map.BOT && map.BOT.usd){
        chainDatabase.bot.price = map.BOT.usd.toLocaleString('en-US');
        if(map.BOT.usd_24h_change != null){
          chainDatabase.bot.change24h = (map.BOT.usd_24h_change>0?'+':'')+map.BOT.usd_24h_change.toFixed(2)+'%';
          chainDatabase.bot.changeDir = map.BOT.usd_24h_change>0?'up':'down';
        }
      }
    }
  } catch(e){ console.error('[Archon] CoinGecko failed', e); }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 16: QR CODE
   ═══════════════════════════════════════════════════════════════════ */
function generateRealQR(containerId, address){
  var el = $(containerId); if(!el||!address) return;
  el.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(address)+'&bgcolor=ffffff&color=000000" alt="QR" style="width:100%;height:100%;border-radius:12px;" />';
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 17: REAL SEND
   ═══════════════════════════════════════════════════════════════════ */
async function realSend(toAddress, amountEth){
  if(!wallet) throw new Error('Wallet not connected');
  if(!ethers.isAddress(toAddress)) throw new Error('Invalid address');
  if(typeof showTxOverlay==='function') showTxOverlay('Sending BOT', 'Preparing your transaction...');
  if(typeof updateTxStep==='function') updateTxStep(1, 'active');
  var amountWei = ethers.parseEther(amountEth.toString());
  var bal = await provider.getBalance(wallet.address);
  if(typeof updateTxStep==='function'){ updateTxStep(1, 'done'); updateTxStep(2, 'active'); }
  if(bal < amountWei) throw new Error('Insufficient balance');
  var feeData = await provider.getFeeData();
  var gasEstimate = await provider.estimateGas({ from:wallet.address, to:toAddress, value:amountWei });
  var gasCost = gasEstimate * (feeData.gasPrice || ethers.parseUnits('1','gwei'));
  if(bal < amountWei + gasCost) throw new Error('Insufficient balance for gas');
  if(typeof updateTxStep==='function'){ updateTxStep(2, 'done'); updateTxStep(3, 'active'); }
  var tx = await wallet.sendTransaction({ to: toAddress, value: amountWei });
  if(typeof updateTxStep==='function'){ updateTxStep(3, 'done'); updateTxStep(4, 'active'); }
  var receipt = await tx.wait();
  if(typeof updateTxStep==='function') updateTxStep(4, 'done');
  if(typeof hideTxOverlay==='function') setTimeout(hideTxOverlay, 800);
  addTx({
    type: 'send', amount: parseFloat(amountEth), token: 'BOT',
    to: toAddress, from: wallet.address, hash: receipt.hash,
    gasUsed: parseFloat(ethers.formatEther(receipt.gasUsed * (receipt.gasPrice || feeData.gasPrice || ethers.parseUnits('1','gwei')))).toFixed(6),
    status: 'confirmed'
  });
  autoSyncCloud();
  return receipt;
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 18: GIFT SEND
   ═══════════════════════════════════════════════════════════════════ */
async function realGiftSend(toAddress, amountEth, message, tokenURI){
  if(!wallet || !sbtContract) throw new Error('Wallet not connected');
  var amountWei = ethers.parseEther(amountEth.toString());
  var bal = await provider.getBalance(wallet.address);
  var feeData = await provider.getFeeData();
  var gasEstimate = await sbtContract.mintSoulboundGift.estimateGas(
    toAddress, tokenURI || 'ipfs://default', message || 'Gift from Archon', { value: amountWei }
  );
  var gasCost = gasEstimate * (feeData.gasPrice || ethers.parseUnits('1','gwei'));
  if(bal < amountWei + gasCost) throw new Error('Insufficient balance for gift + gas');
  var tx = await sbtContract.mintSoulboundGift(
    toAddress, tokenURI || 'ipfs://default', message || 'Gift from Archon', { value: amountWei }
  );
  var receipt = await tx.wait();
  var tokenId = null;
  for(var i = 0; i < (receipt.logs || []).length; i++){
    try {
      var parsed = sbtContract.interface.parseLog(receipt.logs[i]);
      if(parsed && parsed.name === 'SoulboundGiftMinted'){
        tokenId = parsed.args.tokenId.toString();
        break;
      }
    } catch(e){}
  }
  addTx({
    type: 'gift_sent', amount: parseFloat(amountEth), token: 'BOT',
    to: toAddress, from: wallet.address, hash: receipt.hash,
    gasUsed: parseFloat(ethers.formatEther(receipt.gasUsed * (receipt.gasPrice || feeData.gasPrice || ethers.parseUnits('1','gwei')))).toFixed(6),
    status: 'confirmed', tokenId: tokenId
  });
  autoSyncCloud();
  return { hash: receipt.hash, tokenId: tokenId };
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 19: GIFT CLAIM
   ═══════════════════════════════════════════════════════════════════ */
async function realGiftClaim(tokenId){
  if(!sbtContract) throw new Error('Wallet not connected');
  var tx = await sbtContract.convertToBot(tokenId);
  var receipt = await tx.wait();
  addTx({
    type: 'gift_claimed', amount: 0, token: 'BOT',
    from: 'Gift Voucher', to: wallet.address, hash: receipt.hash,
    status: 'confirmed', tokenId: tokenId
  });
  autoSyncCloud();
  return receipt;
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 20: READ GIFT DATA
   ═══════════════════════════════════════════════════════════════════ */
async function readGiftData(tokenId){
  if(!sbtContract) return null;
  try {
    var data = await sbtContract.getGiftData(tokenId);
    return { sender: data.sender, recipient: data.recipient, message: data.message, amount: parseFloat(ethers.formatEther(data.amount)), timestamp: Number(data.timestamp) };
  } catch(e){ return null; }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 21: ADD BOT TO METAMASK
   ═══════════════════════════════════════════════════════════════════ */
async function addBotToMetaMask(){
  if(!window.ethereum) throw new Error('MetaMask not installed');
  try {
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: BOT_CHAIN_HEX, chainName: 'BOT Chain Testnet',
        nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
        rpcUrls: [BOT_RPC], blockExplorerUrls: [BOT_EXPLORER]
      }]
    });
  } catch(e){ throw new Error('Failed to add network'); }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 22: GIFT FUNCTIONS WIRING
   ═══════════════════════════════════════════════════════════════════ */
function wireRealFunctions(){
  window.doRealSend = function(){
    var toAddr = $('cxSendTo') ? $('cxSendTo').value.trim() : '';
    var amt = $('cxSendAmt') ? $('cxSendAmt').value : '';
    var btn = $('cxSendBtn');
    if(!toAddr){ if(window.cxToast) window.cxToast('Enter address','err'); return; }
    if(!amt || parseFloat(amt) <= 0){ if(window.cxToast) window.cxToast('Enter amount','err'); return; }
    btn.disabled = true;
    realSend(toAddr, parseFloat(amt)).then(function(){
      if(window.cxToast) window.cxToast('Sent!','ok');
      btn.disabled = false;
      globalRefresh();
    }).catch(function(err){
      btn.disabled = false;
      if(window.cxToast) window.cxToast('Send failed: '+(err.message||'Unknown'),'err');
    });
  };

  window.gvConfirm = function(){
    var GV=window._GV, genCodeFn=window._genCode, buildSentFn=window._buildSent;
    if(!GV||!genCodeFn||!buildSentFn){ console.error('[Archon] Gift functions not loaded'); return; }
    var ov=$('gvOverlay'); if(ov) ov.classList.add('show');
    var coin=$('gvOvCoin'); if(coin) coin.src=GV.t.img;
    var bar=$('gvOvBar'); if(bar) bar.style.width='0%';
    var pct=$('gvOvPct'); if(pct) pct.textContent='0%';
    var status=$('gvOvStatus'); if(status) status.textContent='Preparing gift...';
    var progress=0;
    var iv=setInterval(function(){ progress+=Math.random()*15+5; if(progress>90) progress=90; if(bar) bar.style.width=progress+'%'; if(pct) pct.textContent=Math.round(progress)+'%'; },300);
    var code=genCodeFn();
    var usdVal=GV.amount*GV.t.price;
    var payload={sym:GV.t.sym,name:GV.t.name,amount:GV.amount,usd:usdVal,to:GV.to,message:GV.msg,code:code,testnet:true};
    if(wallet&&walletData&&GV.t.sym==='$BOT'){
      if(status) status.textContent='Sending on-chain gift...';
      realGiftSend(GV.to,GV.amount,GV.msg||'Gift from Archon',null).then(function(result){
        clearInterval(iv); if(bar) bar.style.width='100%'; if(pct) pct.textContent='100%';
        if(status) status.textContent='Gift sealed on-chain!';
        payload.txHash=result.hash;
        if(result.tokenId) saveGiftCode(code, result.tokenId, GV.amount, GV.to);
        setTimeout(function(){ if(ov) ov.classList.remove('show'); buildSentFn(payload); showPage('page-gift-sent'); if(typeof confetti==='function') confetti(); },1200);
        globalRefresh();
      }).catch(function(err){
        clearInterval(iv); if(bar) bar.style.width='100%'; if(pct) pct.textContent='100%';
        if(status) status.textContent='Gift failed: '+(err.message||'Unknown');
        setTimeout(function(){ if(ov) ov.classList.remove('show'); },2000);
      });
    } else {
      if(window.cxToast) window.cxToast('Only BOT gifts supported on testnet','err');
      clearInterval(iv); if(ov) ov.classList.remove('show');
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 23: IMPORT WALLET FROM MNEMONIC
   ═══════════════════════════════════════════════════════════════════ */
function importFromMnemonic(mnemonic){
  if(typeof ethers === 'undefined') throw new Error('ethers.js not loaded');
  try {
    var w = ethers.Wallet.fromPhrase(mnemonic.trim());
    walletData = { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic.phrase, createdAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
    initProvider();
    return walletData;
  } catch(e){ console.error('[Archon] import error', e); return null; }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 24: IMPORT FROM PRIVATE KEY
   ═══════════════════════════════════════════════════════════════════ */
function importFromPrivateKey(privateKey){
  if(typeof ethers === 'undefined') throw new Error('ethers.js not loaded');
  try {
    var w = new ethers.Wallet(privateKey.trim());
    walletData = { address: w.address, privateKey: w.privateKey, mnemonic: null, createdAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
    initProvider();
    return walletData;
  } catch(e){ console.error('[Archon] import PK error', e); return null; }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 25: SAVE USER PROFILE
   ═══════════════════════════════════════════════════════════════════ */
function saveProfile(name, dob, address){
  var profile = { name:name, dob:dob, address:address, createdAt:Date.now() };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  autoSyncCloud();
}
function getProfile(){
  try { var raw = localStorage.getItem(PROFILE_KEY); if(raw) return JSON.parse(raw); } catch(e){}
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 26: CREATE REAL WALLET
   ═══════════════════════════════════════════════════════════════════ */
function createReal(name, dob, walletName, address){
  if(!name) throw new Error('Please enter your name');
  if(!dob) throw new Error('Please enter your date of birth');
  if(!walletName) throw new Error('Please enter a wallet name');
  var wd = createWallet();
  saveProfile(name, dob, address);
  console.log('[Archon] Wallet created:', wd.address);
  return wd;
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 27: IMPORT REAL WALLET
   ═══════════════════════════════════════════════════════════════════ */
function importReal(mnemonic){
  if(!mnemonic) throw new Error('Please enter your recovery phrase');
  var words = mnemonic.split(/\s+/);
  if(words.length < 12) throw new Error('Recovery phrase must be at least 12 words');
  var wd = importFromMnemonic(mnemonic);
  if(!wd) throw new Error('Invalid recovery phrase');
  console.log('[Archon] Wallet imported:', wd.address);
  return wd;
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 28: UPDATE WALLET UI
   ═══════════════════════════════════════════════════════════════════ */
function updateWalletUI(){
  if(!walletData) return;
  var addr = walletData.address;
  var depAddrText = $('cxDepAddrText'); if(depAddrText) depAddrText.textContent = addr;
  var depAddr = $('cxDepAddr'); if(depAddr) depAddr.textContent = addr;
  generateRealQR('cxDepQr', addr);
  if(typeof updateWalletPocket==='function') updateWalletPocket();
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 29: GLOBAL REFRESH
   ═══════════════════════════════════════════════════════════════════ */
function globalRefresh(){
  return Promise.all([fetchAllBalances(), fetchPrices()]).then(function(){
    if(typeof updateActiveChainView==='function'){ try{updateActiveChainView('bot');}catch(e){} }
    updateWalletUI();
    if(typeof renderTxHistory==='function') renderTxHistory();
    if(typeof updateWalletPocket==='function') updateWalletPocket();
  });
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 30: RENDER TX HISTORY
   ═══════════════════════════════════════════════════════════════════ */
function renderTxHistory(){
  var el = $('txHistoryList');
  if(!el) return;
  var list = getTxHistory();
  if(list.length === 0){
    el.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#9ca3af"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 16px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><div style="font-size:15px;font-weight:700;color:#374151;margin-bottom:4px">No transactions yet</div><div style="font-size:13px;color:#9ca3af">Your transaction history will appear here</div></div>';
    return;
  }
  var html = '';
  for(var i=0;i<list.length;i++){
    var tx = list[i];
    var icon, typeLabel, amtPrefix, color, bg;
    var timeStr = formatTimeAgo(tx.timestamp);
    var addrStr = '';
    if(tx.type==='send'){ icon='&#8593;'; typeLabel='Sent'; amtPrefix='-'; color='#ef4444'; bg='#fef2f2'; addrStr=tx.to?'To '+shortAddr(tx.to):''; }
    else if(tx.type==='receive'){ icon='&#8595;'; typeLabel='Received'; amtPrefix='+'; color='#22c55e'; bg='#f0fdf4'; addrStr=tx.from?'From '+shortAddr(tx.from):''; }
    else if(tx.type==='gift_sent'){ icon='&#127873;'; typeLabel='Gift Sent'; amtPrefix='-'; color='#a855f7'; bg='#faf5ff'; addrStr=tx.to?'To '+shortAddr(tx.to):''; }
    else if(tx.type==='gift_claimed'){ icon='&#127873;'; typeLabel='Gift Claimed'; amtPrefix='+'; color='#22c55e'; bg='#f0fdf4'; addrStr=tx.from?'From '+shortAddr(tx.from):''; }
    else { icon='&#8226;'; typeLabel='Transaction'; amtPrefix=''; color='#6b7280'; bg='#f9fafb'; }
    var statusDot = tx.status==='confirmed' ? '<span style="color:#22c55e;font-size:10px">&#9679;</span>' : '<span style="color:#ef4444;font-size:10px">&#9679;</span>';
    var hashShort = tx.hash ? tx.hash.slice(0,10)+'...' : '';
    html += '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border-radius:14px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.04)" onclick="window.cxOpenTxDetail && window.cxOpenTxDetail('+i+')">'+
      '<div style="width:40px;height:40px;border-radius:12px;background:'+bg+';display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">'+icon+'</div>'+
      '<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:13px;font-weight:700;color:#1a1a1a">'+typeLabel+'</span>'+
      '<span style="font-size:13px;font-weight:800;color:'+color+'">'+amtPrefix+fmt(tx.amount)+' '+(tx.token||'BOT')+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px"><span style="font-size:11px;color:#9ca3af">'+addrStr+(hashShort?' &#183; '+hashShort:'')+'</span>'+
      '<span style="font-size:11px;color:#9ca3af">'+statusDot+' '+timeStr+'</span></div></div></div>';
  }
  el.innerHTML = html;
}
function formatTimeAgo(ts){
  var diff = Date.now() - ts;
  if(diff < 60000) return 'Just now';
  if(diff < 3600000) return Math.floor(diff/60000)+'m ago';
  if(diff < 86400000) return Math.floor(diff/3600000)+'h ago';
  if(diff < 604800000) return Math.floor(diff/86400000)+'d ago';
  return new Date(ts).toLocaleDateString();
}

window.cxOpenTxDetail = function(idx){
  var list = getTxHistory();
  var tx = list[idx];
  if(!tx) return;
  var el = $('txDetailContent');
  if(!el) return;
  var typeLabel = tx.type==='send'?'Sent':tx.type==='receive'?'Received':tx.type==='gift_sent'?'Gift Sent':tx.type==='gift_claimed'?'Gift Claimed':'Transaction';
  var color = (tx.type==='send'||tx.type==='gift_sent')?'#ef4444':'#22c55e';
  el.innerHTML = '<div style="text-align:center;padding:20px 0">'+
    '<div style="width:56px;height:56px;border-radius:16px;background:'+(tx.type==='send'||tx.type==='gift_sent'?'#fef2f2':'#f0fdf4')+';display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 12px">'+(tx.type==='gift_sent'||tx.type==='gift_claimed'?'&#127873;':(tx.type==='send'?'&#8593;':'&#8595;'))+'</div>'+
    '<div style="font-size:13px;font-weight:700;color:#9ca3af;margin-bottom:4px">'+typeLabel+'</div>'+
    '<div style="font-size:28px;font-weight:900;color:'+color+'">'+((tx.type==='send'||tx.type==='gift_sent')?'-':'+')+fmt(tx.amount)+' '+(tx.token||'BOT')+'</div>'+
    '<div style="font-size:13px;color:#9ca3af;margin-top:4px">'+(BOT_PRICE_USD>0?'&#8776; $'+(tx.amount*BOT_PRICE_USD).toFixed(2):'')+'</div>'+
    '</div>'+
    '<div style="background:#f9fafb;border-radius:14px;padding:16px;margin-top:8px">'+
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;color:#9ca3af;font-weight:600">Status</span><span style="font-size:12px;font-weight:700;color:'+(tx.status==='confirmed'?'#22c55e':'#ef4444')+'">'+(tx.status==='confirmed'?'Confirmed':'Failed')+'</span></div>'+
    (tx.to?'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;color:#9ca3af;font-weight:600">To</span><span style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">'+shortAddr(tx.to)+'</span></div>':'')+
    (tx.from?'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;color:#9ca3af;font-weight:600">From</span><span style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">'+shortAddr(tx.from)+'</span></div>':'')+
    (tx.hash?'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;color:#9ca3af;font-weight:600">Hash</span><span style="font-size:12px;font-weight:700;color:#7c3aed;font-family:monospace;cursor:pointer" onclick="window.cxCopy(\''+tx.hash+'\',\'Hash copied\')">'+shortAddr(tx.hash)+' &#8599;</span></div>':'')+
    (tx.gasUsed?'<div style="display:flex;justify-content:space-between;padding:8px 0"><span style="font-size:12px;color:#9ca3af;font-weight:600">Gas Fee</span><span style="font-size:12px;font-weight:700;color:#1a1a1a">'+tx.gasUsed+' BOT</span></div>':'')+
    '<div style="display:flex;justify-content:space-between;padding:8px 0"><span style="font-size:12px;color:#9ca3af;font-weight:600">Time</span><span style="font-size:12px;font-weight:700;color:#1a1a1a">'+new Date(tx.timestamp).toLocaleString()+'</span></div>'+
    '</div>'+
    (tx.hash?'<button style="width:100%;margin-top:16px;padding:14px;background:#1a1a1a;color:#fff;border:none;border-radius:14px;font-size:14px;font-weight:800;cursor:pointer" onclick="window.open(\''+BOT_EXPLORER+'/tx/'+tx.hash+'\',\'_blank\')">View on Explorer &#8599;</button>':'');
  navigateTo('page-tx-detail');
};

/* ═══════════════════════════════════════════════════════════════════
   SECTION 31: GIFT CODE REDEEM
   ═══════════════════════════════════════════════════════════════════ */
async function redeemGiftCode(code){
  if(!code || code.length < 5) throw new Error('Please enter a valid gift code');
  var codeUpper = code.toUpperCase().trim();
  var giftInfo = lookupGiftCode(codeUpper);
  if(!giftInfo) throw new Error('Gift code not found. Make sure you entered the correct code.');
  var tokenId = giftInfo.tokenId;
  if(!sbtContract) throw new Error('Wallet not connected');
  var giftData = await readGiftData(tokenId);
  if(!giftData) throw new Error('Gift not found on-chain');
  var owner = await sbtContract.ownerOf(tokenId);
  if(owner.toLowerCase() !== walletData.address.toLowerCase()){
    throw new Error('This gift was sent to a different address. Connect the recipient wallet to claim.');
  }
  var result = await realGiftClaim(tokenId);
  return { hash: result.hash, amount: giftData.amount, sender: giftData.sender, message: giftData.message };
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 32: AUTO-INIT
   ═══════════════════════════════════════════════════════════════════ */
function autoInit(){
  try {
    var existed = loadWallet();
    if(existed){
      initProvider();
      if(typeof replaceAddresses==='function') replaceAddresses();
      console.log('[Archon] Loaded existing wallet:',walletData.address);
    } else {
      console.log('[Archon] No wallet found');
    }
    wireRealFunctions();
    setTimeout(function(){
      if(walletData){
        Promise.all([fetchAllBalances(), fetchPrices()]).then(function(){
          if(typeof updateActiveChainView==='function'){ try{updateActiveChainView('bot');}catch(e){} }
          updateWalletUI();
          if(typeof renderTxHistory==='function') renderTxHistory();
        });
      }
    },500);
    setInterval(function(){
      if(walletData){
        Promise.all([fetchAllBalances(), fetchPrices()]).then(function(){
          if(typeof updateActiveChainView==='function'){ try{updateActiveChainView('bot');}catch(e){} }
          updateWalletUI();
        });
      }
    },30000);
  } catch(e){ console.error('[Archon] autoInit error', e); }
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION 33: PUBLIC API
   ═══════════════════════════════════════════════════════════════════ */
window.WalletEngine = {
  loadWallet:loadWallet, createWallet:createWallet, importFromMnemonic:importFromMnemonic,
  importFromPrivateKey:importFromPrivateKey,
  createReal:createReal, importReal:importReal, logoutWallet:logoutWallet,
  saveProfile:saveProfile, getProfile:getProfile,
  getAddress:function(){return walletData?walletData.address:null;},
  getShortAddress:function(){return walletData?shortAddr(walletData.address):'';},
  getPrivateKey:function(){return walletData?walletData.privateKey:null;},
  getMnemonic:function(){return walletData?walletData.mnemonic:null;},
  fetchBOTBalance:fetchBOTBalance, fetchAllBalances:fetchAllBalances, fetchPrices:fetchPrices,
  getBOTBalance:function(){return lastKnownBalance;},
  estimateGasFee:estimateGasFee,
  realSend:realSend, realGiftSend:realGiftSend, realGiftClaim:realGiftClaim, readGiftData:readGiftData,
  redeemGiftCode:redeemGiftCode,
  generateRealQR:generateRealQR, addBotToMetaMask:addBotToMetaMask,
  updateWalletUI:updateWalletUI, globalRefresh:globalRefresh, updateWalletPocket:function(){if(typeof updateWalletPocket==='function')updateWalletPocket();},
  getTxHistory:getTxHistory, addTx:addTx, renderTxHistory:renderTxHistory,
  getGiftCodes:getGiftCodes, saveGiftCode:saveGiftCode, lookupGiftCode:lookupGiftCode,
  isInitialized:function(){return !!walletData;},
  autoInit:autoInit,
  getBOTPrice:function(){return BOT_PRICE_USD;},
  hasWallet:function(){return !!localStorage.getItem(STORAGE_KEY);},
  SBT_ADDRESS:SBT_ADDRESS, BOT_RPC:BOT_RPC, BOT_CHAIN_ID:BOT_CHAIN_ID, BOT_EXPLORER:BOT_EXPLORER,
  generateRecoveryKey:generateRecoveryKey, formatRecoveryKey:formatRecoveryKey,
  normalizeRecoveryKey:normalizeRecoveryKey, saveRecoveryKey:saveRecoveryKey,
  restoreFromSeed:restoreFromSeed, restoreFromKey:restoreFromKey,
  saveWalletToCloud:saveWalletToCloud, autoSyncCloud:autoSyncCloud,
  encryptText:encryptText, decryptText:decryptText,
  getPoints:getPoints, addPoints:addPoints,
  extractError:extractError,
  setPin:setPin, getPin:getPin, isPinSet:isPinSet, verifyPin:verifyPin,
  clearPin:clearPin, setPinEnabled:setPinEnabled, isPinEnabled:isPinEnabled,
  refreshAllData:refreshAllData, fetchOnChainTransactions:fetchOnChainTransactions,
  fetchGiftActivity:fetchGiftActivity
};

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){ autoInit(); });}else{autoInit();}

})();
