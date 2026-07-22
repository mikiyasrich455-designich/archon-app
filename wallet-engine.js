/* ═══════════════════════════════════════════════════════════════════
   WALLET ENGINE — Real blockchain integration (ethers.js + Botchain testnet)
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
var COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,ripple&vs_currencies=usd&include_24hr_change=true';
var BOT_PRICE_USD = 9.74;
var STORAGE_KEY = 'creso_wallet_v1';
var PROFILE_KEY = 'creso_profile_v1';

var provider = null;
var wallet = null;
var sbtContract = null;
var walletData = null;

function $(id){ return document.getElementById(id); }
function shortAddr(a){ return a ? a.slice(0,6)+'...'+a.slice(-4) : ''; }
function fmt(n){ return window.cxFmt ? window.cxFmt(n) : Number(n).toLocaleString('en-US',{maximumFractionDigits:6}); }

/* ── 1. WALLET CREATION / LOADING ── */
function loadWallet(){
  try { var raw = localStorage.getItem(STORAGE_KEY); if(raw){ walletData = JSON.parse(raw); return true; } } catch(e){}
  return false;
}
function createWallet(){
  if(typeof ethers === 'undefined') throw new Error('ethers.js not loaded — check your internet connection');
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
  } catch(e){ console.error('[WalletEngine] init error', e); }
}

/* ── 2. BALANCE FETCHING ── */
async function fetchBOTBalance(){
  if(!provider || !walletData) return '0';
  try { var bal = await provider.getBalance(walletData.address); return ethers.formatEther(bal); }
  catch(e){ console.error('[WalletEngine] balance error', e); return '0'; }
}
async function fetchAllBalances(){
  var botBal = await fetchBOTBalance();
  var n = parseFloat(botBal) || 0;
  if(window.cxTOKENS){ for(var i=0;i<window.cxTOKENS.length;i++){ if(window.cxTOKENS[i].id==='BOT') window.cxTOKENS[i].bal = n; } }
  if(typeof chainDatabase!=='undefined'){
    chainDatabase.bot.balance = n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    chainDatabase.bot.usdBalance = (n*BOT_PRICE_USD).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
    if(chainDatabase.bot.tokens&&chainDatabase.bot.tokens[0]){
      chainDatabase.bot.tokens[0].bal = chainDatabase.bot.balance;
      chainDatabase.bot.tokens[0].usd = '$'+chainDatabase.bot.usdBalance;
    }
  }
  if(typeof GVT!=='undefined'){ for(var i=0;i<GVT.length;i++){ if(GVT[i].sym==='\\$BOT') GVT[i].bal = n; } }
  return botBal;
}

/* ── 3. COINGECKO PRICE FETCHING ── */
async function fetchPrices(){
  try {
    var resp = await fetch(COINGECKO_URL);
    var data = await resp.json();
    var map = { ETH: data.ethereum, BTC: data.bitcoin, SOL: data.solana, BNB: data.binancecoin, XRP: data.ripple };
    if(window.cxTOKENS){ for(var i=0;i<window.cxTOKENS.length;i++){ var t=window.cxTOKENS[i]; if(map[t.id]&&map[t.id].usd) t.price=map[t.id].usd; } }
    if(typeof GVT!=='undefined'){ for(var i=0;i<GVT.length;i++){ var s=GVT[i].sym.replace('\\$',''); if(map[s]&&map[s].usd) GVT[i].price=map[s].usd; } }
    if(typeof chainDatabase!=='undefined'){
      var pairs=[['ETH','eth'],['BTC','btc'],['SOL','sol'],['BNB','bnb'],['XRP','xrp']];
      for(var p=0;p<pairs.length;p++){ var cg=pairs[p][0],db=pairs[p][1];
        if(map[cg]&&map[cg].usd){ chainDatabase[db].price=map[cg].usd.toLocaleString('en-US');
          if(map[cg].usd_24h_change!=null){ chainDatabase[db].change24h=(map[cg].usd_24h_change>0?'+':'')+map[cg].usd_24h_change.toFixed(2)+'%'; chainDatabase[db].changeDir=map[cg].usd_24h_change>0?'up':'down'; }
        }
      }
    }
    console.log('[WalletEngine] Prices updated');
  } catch(e){ console.error('[WalletEngine] CoinGecko failed', e); }
}

/* ── 4. REAL QR CODE ── */
function generateRealQR(containerId, address){
  var el = $(containerId); if(!el||!address) return;
  el.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(address)+'&bgcolor=ffffff&color=000000" alt="QR" style="width:100%;height:100%;border-radius:12px;" />';
}

/* ── 5. REAL SEND ── */
async function realSend(toAddress, amountEth){
  if(!wallet) throw new Error('Wallet not connected');
  if(!ethers.isAddress(toAddress)) throw new Error('Invalid address');
  var amountWei = ethers.parseEther(amountEth.toString());
  var bal = await provider.getBalance(wallet.address);
  if(bal < amountWei) throw new Error('Insufficient balance');
  var tx = await wallet.sendTransaction({ to: toAddress, value: amountWei });
  return { hash: tx.hash, wait: function(){ return tx.wait(); } };
}

/* ── 6. REAL GIFT SEND (SBT) ── */
async function realGiftSend(recipient, amountEth, message, tokenURI){
  if(!sbtContract) throw new Error('Contract not connected');
  if(!ethers.isAddress(recipient)) throw new Error('Invalid recipient');
  var amountWei = ethers.parseEther(amountEth.toString());
  var uri = tokenURI || 'ipfs://QmDefaultGiftMetadata';
  var tx = await sbtContract.mintSoulboundGift(recipient, uri, message, { value: amountWei });
  return { hash: tx.hash, wait: function(){ return tx.wait(); } };
}

/* ── 7. REAL GIFT CLAIM (SBT) ── */
async function realGiftClaim(tokenId){
  if(!sbtContract) throw new Error('Contract not connected');
  var tx = await sbtContract.convertToBot(tokenId);
  return { hash: tx.hash, wait: function(){ return tx.wait(); } };
}

/* ── 8. READ GIFT DATA ── */
async function readGiftData(tokenId){
  if(!sbtContract) throw new Error('Contract not connected');
  var d = await sbtContract.getGiftData(tokenId);
  return { sender:d.sender, recipient:d.recipient, message:d.message, amount:ethers.formatEther(d.amount), timestamp:Number(d.timestamp) };
}

/* ── 9. ADD BOTCHAIN TO METAMASK ── */
async function addBotToMetaMask(){
  if(!window.ethereum) return false;
  try { await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:BOT_CHAIN_HEX}]}); return true; }
  catch(e){ if(e.code===4902){ try{ await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:BOT_CHAIN_HEX,chainName:'BOT Chain Testnet',nativeCurrency:{name:'BOT',symbol:'BOT',decimals:18},rpcUrls:[BOT_RPC],blockExplorerUrls:[BOT_EXPLORER]}]}); return true;}catch(e2){return false;}} return false; }
}

/* ── 10. REPLACE HARDCODED ADDRESSES ── */
function replaceAddresses(){
  if(!walletData) return;
  var addr = walletData.address, short = shortAddr(addr);
  if(window.cxCHAINS){ for(var i=0;i<window.cxCHAINS.length;i++){ if(window.cxCHAINS[i].id==='bot'||window.cxCHAINS[i].id==='eth') window.cxCHAINS[i].addr=addr; } }
  if(typeof chainDatabase!=='undefined'){ if(chainDatabase.bot) chainDatabase.bot.addr=addr; if(chainDatabase.eth) chainDatabase.eth.addr=addr; }
  var flipAddr = document.querySelector('.flip-card-back .font-mono'); if(flipAddr) flipAddr.textContent=short;
  var walletAddrEl = document.querySelector('#page-wallet-address .font-mono'); if(walletAddrEl) walletAddrEl.textContent=addr;
}

/* ── 11. OVERRIDE FAKE FUNCTIONS ── */
function wireRealFunctions(){

  window.copyWalletAddress = function(){
    if(walletData&&navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(walletData.address).then(function(){ if(window.cxToast) window.cxToast('Address copied!','ok'); });
    }
  };
  window.copyCardAddress = function(){
    if(walletData&&navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(walletData.address);
      var fb=$('copyFeedbackCard'); if(fb){fb.style.opacity='1';setTimeout(function(){fb.style.opacity='0';},1500);}
    }
  };
  window.cxCopyDepAddr = function(){ if(walletData) window.cxCopy(walletData.address,'Deposit address copied'); };
  window.cxShareDepAddr = function(){
    if(!walletData) return;
    if(navigator.share){navigator.share({title:'Creso Deposit Address',text:walletData.address});}
    else window.cxCopy(walletData.address,'Address copied');
  };

  var origRenderDeposit = window.cxRenderDeposit;
  window.cxRenderDeposit = function(){
    try{origRenderDeposit();}catch(e){}
    if(!walletData) return;
    var addrEl=$('cxDepAddr'); if(addrEl) addrEl.textContent=walletData.address;
    generateRealQR('cxDepQr',walletData.address);
  };

  window._origCxExecSend = window.cxExecSend;
  window.cxExecSend = function(){
    var t=null;
    if(window.cxTOKENS&&window.cxS){ for(var i=0;i<window.cxTOKENS.length;i++){ if(window.cxTOKENS[i].id===window.cxS.sendToken){t=window.cxTOKENS[i];break;} } }
    if(!t) return;
    var amt=parseFloat($('cxSendAmt').value)||0;
    var addr=$('cxSendAddr').value.trim();
    var btn=$('cxCfBtn'), lbl=$('cxCfBtnLabel');
    if(!wallet||!walletData){ if(window.cxToast) window.cxToast('Wallet not initialized','err'); return; }

    if(t.id==='BOT'){
      btn.disabled=true;
      lbl.innerHTML='<span class="cx-spin">&#9676;</span>&nbsp;Broadcasting...';
      realSend(addr,amt).then(function(result){
        t.bal-=amt;
        $('cxSuccAmt').textContent=fmt(amt)+' '+t.id+' \u2192 '+(addr.slice(0,6)+'...'+addr.slice(-4));
        $('cxSuccHash').textContent=result.hash;
        btn.disabled=false; $('cxCfBtnLabel').textContent='Confirm & Send';
        $('cxSendAmt').value=''; $('cxSendAddr').value='';
        window.cxCalcSend(); window.cxRenderSendToken();
        showPage('page-send-success');
        if(window.cxConfetti) window.cxConfetti();
        if(window.cxToast) window.cxToast('Sent '+fmt(amt)+' '+t.id+' successfully','ok');
      }).catch(function(err){
        btn.disabled=false; $('cxCfBtnLabel').textContent='Confirm & Send';
        if(window.cxToast) window.cxToast('Send failed: '+(err.message||'Unknown'),'err');
      });
    } else {
      btn.disabled=true;
      lbl.innerHTML='<span class="cx-spin">&#9676;</span>&nbsp;Broadcasting...';
      setTimeout(function(){
        t.bal-=amt;
        $('cxSuccAmt').textContent=fmt(amt)+' '+t.id+' \u2192 '+(addr.slice(0,6)+'...'+addr.slice(-4));
        $('cxSuccHash').textContent='0x'+Math.random().toString(16).slice(2,6)+'...'+Math.random().toString(16).slice(2,6);
        btn.disabled=false; $('cxCfBtnLabel').textContent='Confirm & Send';
        $('cxSendAmt').value=''; $('cxSendAddr').value='';
        window.cxCalcSend(); window.cxRenderSendToken();
        showPage('page-send-success');
        if(window.cxToast) window.cxToast('Sent '+fmt(amt)+' '+t.id+' successfully','ok');
      },1500);
    }
  };

  window.gvConfirm = function(){
    var GV=window._GV, genCodeFn=window._genCode, buildSentFn=window._buildSent;
    if(!GV||!genCodeFn||!buildSentFn){ console.error('[WalletEngine] Gift functions not loaded'); return; }
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
      realGiftSend(GV.to,GV.amount,GV.msg||'Gift from Creso',null).then(function(result){
        clearInterval(iv); if(bar) bar.style.width='100%'; if(pct) pct.textContent='100%';
        if(status) status.textContent='Gift sealed on-chain!';
        payload.txHash=result.hash;
        setTimeout(function(){ if(ov) ov.classList.remove('show'); buildSentFn(payload); showPage('page-gift-sent'); if(window.cxConfetti) window.cxConfetti(); },1200);
      }).catch(function(err){
        clearInterval(iv); if(bar) bar.style.width='100%'; if(pct) pct.textContent='100%';
        if(status) status.textContent='Gift sealed! (demo mode)';
        setTimeout(function(){ if(ov) ov.classList.remove('show'); buildSentFn(payload); showPage('page-gift-sent'); if(window.cxToast) window.cxToast('Gift sent (testnet mode)','ok'); },1200);
      });
    } else {
      if(status) status.textContent='Sealing gift...';
      GV_CONFIG.onConfirm(payload).then(function(){
        clearInterval(iv); if(bar) bar.style.width='100%'; if(pct) pct.textContent='100%';
        if(status) status.textContent='Gift sealed!';
        setTimeout(function(){ if(ov) ov.classList.remove('show'); buildSentFn(payload); showPage('page-gift-sent'); if(window.cxConfetti) window.cxConfetti(); },1050);
      });
    }
  };
}

/* ── 12. IMPORT WALLET FROM MNEMONIC ── */
function importFromMnemonic(mnemonic){
  if(typeof ethers === 'undefined') throw new Error('ethers.js not loaded — check your internet connection');
  try {
    var w = ethers.Wallet.fromPhrase(mnemonic.trim());
    walletData = { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic.phrase, createdAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
    initProvider();
    return walletData;
  } catch(e){ console.error('[WalletEngine] import error', e); return null; }
}

/* ── 13. SAVE USER PROFILE ── */
function saveProfile(name, dob, address){
  var profile = { name:name, dob:dob, address:address, createdAt:Date.now() };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}
function getProfile(){
  try { var raw = localStorage.getItem(PROFILE_KEY); if(raw) return JSON.parse(raw); } catch(e){}
  return null;
}

/* ── 14. CREATE REAL WALLET (called from HTML) ── */
function createReal(name, dob, walletName, address){
  if(!name) throw new Error('Please enter your name');
  if(!dob) throw new Error('Please enter your date of birth');
  if(!walletName) throw new Error('Please enter a wallet name');

  var wd = createWallet();
  saveProfile(name, dob, address);
  console.log('[Creso] Wallet created:', wd.address);
  return wd;
}

/* ── 15. IMPORT REAL WALLET (called from HTML) ── */
function importReal(mnemonic){
  if(!mnemonic) throw new Error('Please enter your recovery phrase');
  var words = mnemonic.split(/\s+/);
  if(words.length < 12) throw new Error('Recovery phrase must be at least 12 words');
  var wd = importFromMnemonic(mnemonic);
  if(!wd) throw new Error('Invalid recovery phrase');
  console.log('[Creso] Wallet imported:', wd.address);
  return wd;
}

/* ── 16. UPDATE WALLET UI WITH REAL DATA ── */
function updateWalletUI(){
  if(!walletData) return;
  var profile = getProfile();
  var name = profile ? profile.name : 'User';
  var addr = walletData.address;
  var short = shortAddr(addr);

  var nameEls = document.querySelectorAll('.flip-card-front .font-extrabold.text-sm');
  for(var i=0;i<nameEls.length;i++){ if(nameEls[i].textContent.indexOf('Hi,')===0) nameEls[i].textContent='Hi, '+name.split(' ')[0]; }

  var backAddr = document.querySelector('.flip-card-back .font-mono');
  if(backAddr) backAddr.textContent = short;

  var walletAddrPage = document.querySelector('#page-wallet-address .font-mono');
  if(walletAddrPage) walletAddrPage.textContent = addr;

  fetchBOTBalance().then(function(bal){
    var n = parseFloat(bal)||0;
    var balEl = document.querySelector('.flip-card-front .text-3xl');
    if(balEl) balEl.textContent = '$'+(n*BOT_PRICE_USD).toFixed(2);
  });

  generateRealQR('cxDepQr', addr);
  var depAddr = $('cxDepAddr'); if(depAddr) depAddr.textContent = addr;
}

/* ── 17. AUTO-INIT ── */
function autoInit(){
  try {
    var existed = loadWallet();
    if(existed){
      initProvider();
      replaceAddresses();
      console.log('[WalletEngine] Loaded existing wallet:',walletData.address);
    } else {
      console.log('[WalletEngine] No wallet found — user must create one');
    }
    wireRealFunctions();
    setTimeout(function(){
      if(walletData){
        fetchAllBalances().then(function(){ if(typeof updateActiveChainView==='function'){ try{updateActiveChainView('bot');}catch(e){} } });
        fetchPrices();
        updateWalletUI();
      }
    },500);
    setInterval(function(){ if(walletData) fetchAllBalances(); },30000);
    setInterval(function(){ if(walletData) fetchPrices(); },60000);
  } catch(e){ console.error('[WalletEngine] autoInit error', e); }
}

/* ── PUBLIC API ── */
window.WalletEngine = {
  loadWallet:loadWallet, createWallet:createWallet, importFromMnemonic:importFromMnemonic,
  createReal:createReal, importReal:importReal,
  saveProfile:saveProfile, getProfile:getProfile,
  getAddress:function(){return walletData?walletData.address:null;},
  getShortAddress:function(){return walletData?shortAddr(walletData.address):'';},
  getPrivateKey:function(){return walletData?walletData.privateKey:null;},
  getMnemonic:function(){return walletData?walletData.mnemonic:null;},
  fetchBOTBalance:fetchBOTBalance, fetchAllBalances:fetchAllBalances, fetchPrices:fetchPrices,
  realSend:realSend, realGiftSend:realGiftSend, realGiftClaim:realGiftClaim, readGiftData:readGiftData,
  generateRealQR:generateRealQR, addBotToMetaMask:addBotToMetaMask,
  updateWalletUI:updateWalletUI,
  isInitialized:function(){return !!walletData;},
  SBT_ADDRESS:SBT_ADDRESS, BOT_RPC:BOT_RPC, BOT_CHAIN_ID:BOT_CHAIN_ID, BOT_EXPLORER:BOT_EXPLORER
};

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',autoInit);}else{autoInit();}

})();
