/* ═══════════════════════════════════════════════════════════════════
   WALLET ENGINE v2 — Real blockchain + tx history + gift codes + global sync
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
var STORAGE_KEY = 'creso_wallet_v1';
var PROFILE_KEY = 'creso_profile_v1';
var TX_HISTORY_KEY = 'creso_tx_history';
var GIFT_CODES_KEY = 'creso_gift_codes';

var provider = null;
var wallet = null;
var sbtContract = null;
var walletData = null;

function $(id){ return document.getElementById(id); }
function shortAddr(a){ return a ? a.slice(0,6)+'...'+a.slice(-4) : ''; }
function fmt(n){ return Number(n).toLocaleString('en-US',{maximumFractionDigits:6}); }

/* ═══ TX HISTORY ═══ */
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
}

/* ═══ GIFT CODE MAPPING ═══ */
function getGiftCodes(){
  try { var raw = localStorage.getItem(GIFT_CODES_KEY); if(raw) return JSON.parse(raw); } catch(e){}
  return {};
}
function saveGiftCode(code, tokenId, amount, recipient){
  var map = getGiftCodes();
  map[code] = { tokenId: tokenId, amount: amount, recipient: recipient, createdAt: Date.now() };
  localStorage.setItem(GIFT_CODES_KEY, JSON.stringify(map));
}
function lookupGiftCode(code){
  var map = getGiftCodes();
  return map[code] || null;
}

/* ── 1. WALLET CREATION / LOADING ── */
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
  } catch(e){ console.error('[WalletEngine] init error', e); }
}
function logoutWallet(){
  walletData = null; wallet = null; provider = null; sbtContract = null;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PROFILE_KEY);
}

/* ── 2. BALANCE FETCHING ── */
async function fetchBOTBalance(){
  if(!provider || !walletData) return '0';
  try { var bal = await provider.getBalance(walletData.address); return ethers.formatEther(bal); }
  catch(e){ console.error('[WalletEngine] balance error', e); return '0'; }
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
}
async function fetchAllBalances(){
  var botBal = await fetchBOTBalance();
  var n = parseFloat(botBal) || 0;
  syncBalanceToUI(n);
  renderDashboardBalance();
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
  var balEl = document.querySelector('.flip-card-front .text-3xl');
  if(balEl) balEl.textContent = '$'+usdVal;
  var chartBot = document.querySelector('.card-charts p:first-child');
  if(chartBot) chartBot.textContent = 'BOT '+n.toFixed(2);
  var nameEls = document.querySelectorAll('.flip-card-front .font-extrabold.text-sm');
  var profile = getProfile();
  var name = profile ? profile.name : 'User';
  for(var i=0;i<nameEls.length;i++){
    if(nameEls[i].textContent.indexOf('Hi,')===0 || nameEls[i].textContent.indexOf('Hi ')===0)
      nameEls[i].textContent = 'Hi, '+name.split(' ')[0];
  }
}

/* ── 3. REAL GAS ESTIMATION ── */
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
    console.error('[WalletEngine] gas estimate error', e);
    return { gasLimit: '21000', gasPrice: '1', feeBot: '0.000021', feeUsd: '$0.00' };
  }
}

/* ── 4. COINGECKO PRICE FETCHING ── */
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
  } catch(e){ console.error('[WalletEngine] CoinGecko failed', e); }
}

/* ── 5. REAL QR CODE ── */
function generateRealQR(containerId, address){
  var el = $(containerId); if(!el||!address) return;
  el.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(address)+'&bgcolor=ffffff&color=000000" alt="QR" style="width:100%;height:100%;border-radius:12px;" />';
}

/* ── 6. REAL SEND ── */
async function realSend(toAddress, amountEth){
  if(!wallet) throw new Error('Wallet not connected');
  if(!ethers.isAddress(toAddress)) throw new Error('Invalid address');
  var amountWei = ethers.parseEther(amountEth.toString());
  var bal = await provider.getBalance(wallet.address);
  if(bal < amountWei) throw new Error('Insufficient balance');
  var feeData = await provider.getFeeData();
  var gasEstimate = await provider.estimateGas({ from:wallet.address, to:toAddress, value:amountWei });
  var gasCost = gasEstimate * (feeData.gasPrice || ethers.parseUnits('1','gwei'));
  if(bal < amountWei + gasCost) throw new Error('Insufficient balance for gas');
  var tx = await wallet.sendTransaction({ to: toAddress, value: amountWei });
  var receipt = await tx.wait();
  addTx({
    type: 'send',
    amount: parseFloat(amountEth),
    token: 'BOT',
    to: toAddress,
    from: wallet.address,
    hash: tx.hash,
    status: receipt.status === 1 ? 'confirmed' : 'failed',
    gasUsed: receipt.gasUsed ? ethers.formatEther(receipt.gasUsed * (feeData.gasPrice||ethers.parseUnits('1','gwei'))) : '0'
  });
  return { hash: tx.hash, receipt: receipt, wait: function(){ return Promise.resolve(receipt); } };
}

/* ── 7. REAL GIFT SEND (SBT) ── */
async function realGiftSend(recipient, amountEth, message, tokenURI){
  if(!sbtContract) throw new Error('Contract not connected');
  if(!ethers.isAddress(recipient)) throw new Error('Invalid recipient');
  var amountWei = ethers.parseEther(amountEth.toString());
  var uri = tokenURI || 'ipfs://QmDefaultGiftMetadata';
  var tx = await sbtContract.mintSoulboundGift(recipient, uri, message, { value: amountWei });
  var receipt = await tx.wait();
  var tokenId = null;
  if(receipt.logs){
    for(var i=0;i<receipt.logs.length;i++){
      try {
        var parsed = sbtContract.interface.parseLog({ topics: receipt.logs[i].topics, data: receipt.logs[i].data });
        if(parsed && parsed.name === 'SoulboundGiftMinted'){
          tokenId = parsed.args.tokenId.toString();
          break;
        }
      } catch(e){}
    }
  }
  addTx({
    type: 'gift_sent',
    amount: parseFloat(amountEth),
    token: 'BOT',
    to: recipient,
    from: wallet.address,
    hash: tx.hash,
    tokenId: tokenId,
    message: message || '',
    status: receipt.status === 1 ? 'confirmed' : 'failed'
  });
  return { hash: tx.hash, tokenId: tokenId, receipt: receipt, wait: function(){ return Promise.resolve(receipt); } };
}

/* ── 8. REAL GIFT CLAIM (SBT) ── */
async function realGiftClaim(tokenId){
  if(!sbtContract) throw new Error('Contract not connected');
  var tx = await sbtContract.convertToBot(tokenId);
  var receipt = await tx.wait();
  var giftData = null;
  try { giftData = await readGiftData(tokenId); } catch(e){}
  addTx({
    type: 'gift_claimed',
    amount: giftData ? parseFloat(giftData.amount) : 0,
    token: 'BOT',
    from: giftData ? giftData.sender : 'unknown',
    to: wallet.address,
    hash: tx.hash,
    tokenId: tokenId,
    message: giftData ? giftData.message : '',
    status: receipt.status === 1 ? 'confirmed' : 'failed'
  });
  await fetchAllBalances();
  return { hash: tx.hash, receipt: receipt, wait: function(){ return Promise.resolve(receipt); } };
}

/* ── 9. READ GIFT DATA ── */
async function readGiftData(tokenId){
  if(!sbtContract) throw new Error('Contract not connected');
  var d = await sbtContract.getGiftData(tokenId);
  return { sender:d.sender, recipient:d.recipient, message:d.message, amount:ethers.formatEther(d.amount), timestamp:Number(d.timestamp) };
}

/* ── 10. ADD BOTCHAIN TO METAMASK ── */
async function addBotToMetaMask(){
  if(!window.ethereum) return false;
  try { await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:BOT_CHAIN_HEX}]}); return true; }
  catch(e){ if(e.code===4902){ try{ await window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:BOT_CHAIN_HEX,chainName:'BOT Chain Testnet',nativeCurrency:{name:'BOT',symbol:'BOT',decimals:18},rpcUrls:[BOT_RPC],blockExplorerUrls:[BOT_EXPLORER]}]}); return true;}catch(e2){return false;}} return false; }
}

/* ── 11. REPLACE HARDCODED ADDRESSES ── */
function replaceAddresses(){
  if(!walletData) return;
  var addr = walletData.address, short = shortAddr(addr);
  if(window.cxCHAINS){ for(var i=0;i<window.cxCHAINS.length;i++){ if(window.cxCHAINS[i].id==='bot'||window.cxCHAINS[i].id==='eth') window.cxCHAINS[i].addr=addr; } }
  if(typeof chainDatabase!=='undefined'){ if(chainDatabase.bot) chainDatabase.bot.addr=addr; if(chainDatabase.eth) chainDatabase.eth.addr=addr; }
  var flipAddr = document.querySelector('.flip-card-back .font-mono'); if(flipAddr) flipAddr.textContent=short;
  var walletAddrEl = document.querySelector('#page-wallet-address .font-mono'); if(walletAddrEl) walletAddrEl.textContent=addr;
  var depAddrText = $('cxDepAddrText'); if(depAddrText) depAddrText.textContent = addr.length > 20 ? shortAddr(addr) : addr;
  var depAddr = $('cxDepAddr'); if(depAddr) depAddr.textContent = addr;
  var chainAddrs = document.querySelectorAll('.chain-addr');
  for(var i=0;i<chainAddrs.length;i++) chainAddrs[i].textContent = short;
}

/* ── 12. OVERRIDE FAKE FUNCTIONS ── */
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
    var depAddrText=$('cxDepAddrText'); if(depAddrText) depAddrText.textContent=walletData.address;
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
      lbl.innerHTML='Broadcasting...';
      realSend(addr,amt).then(function(result){
        $('cxSuccAmt').textContent=fmt(amt)+' BOT → '+(addr.slice(0,6)+'...'+addr.slice(-4));
        $('cxSuccHash').textContent=result.hash;
        btn.disabled=false; $('cxCfBtnLabel').textContent='Confirm & Send';
        $('cxSendAmt').value=''; $('cxSendAddr').value='';
        window.cxCalcSend(); window.cxRenderSendToken();
        showPage('page-send-success');
        if(typeof confetti==='function') confetti();
        globalRefresh();
      }).catch(function(err){
        btn.disabled=false; $('cxCfBtnLabel').textContent='Confirm & Send';
        if(window.cxToast) window.cxToast('Send failed: '+(err.message||'Unknown'),'err');
      });
    } else {
      if(window.cxToast) window.cxToast('Only BOT is supported on testnet','err');
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

/* ── 13. IMPORT WALLET FROM MNEMONIC ── */
function importFromMnemonic(mnemonic){
  if(typeof ethers === 'undefined') throw new Error('ethers.js not loaded');
  try {
    var w = ethers.Wallet.fromPhrase(mnemonic.trim());
    walletData = { address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic.phrase, createdAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(walletData));
    initProvider();
    return walletData;
  } catch(e){ console.error('[WalletEngine] import error', e); return null; }
}

/* ── 14. SAVE USER PROFILE ── */
function saveProfile(name, dob, address){
  var profile = { name:name, dob:dob, address:address, createdAt:Date.now() };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}
function getProfile(){
  try { var raw = localStorage.getItem(PROFILE_KEY); if(raw) return JSON.parse(raw); } catch(e){}
  return null;
}

/* ── 15. CREATE REAL WALLET ── */
function createReal(name, dob, walletName, address){
  if(!name) throw new Error('Please enter your name');
  if(!dob) throw new Error('Please enter your date of birth');
  if(!walletName) throw new Error('Please enter a wallet name');
  var wd = createWallet();
  saveProfile(name, dob, address);
  console.log('[Creso] Wallet created:', wd.address);
  return wd;
}

/* ── 16. IMPORT REAL WALLET ── */
function importReal(mnemonic){
  if(!mnemonic) throw new Error('Please enter your recovery phrase');
  var words = mnemonic.split(/\s+/);
  if(words.length < 12) throw new Error('Recovery phrase must be at least 12 words');
  var wd = importFromMnemonic(mnemonic);
  if(!wd) throw new Error('Invalid recovery phrase');
  console.log('[Creso] Wallet imported:', wd.address);
  return wd;
}

/* ── 17. UPDATE WALLET UI WITH REAL DATA ── */
function updateWalletUI(){
  if(!walletData) return;
  var profile = getProfile();
  var name = profile ? profile.name : 'User';
  var addr = walletData.address;
  var short = shortAddr(addr);

  var nameEls = document.querySelectorAll('.flip-card-front .font-extrabold.text-sm');
  for(var i=0;i<nameEls.length;i++){ if(nameEls[i].textContent.indexOf('Hi,')===0||nameEls[i].textContent.indexOf('Hi ')===0) nameEls[i].textContent='Hi, '+name.split(' ')[0]; }

  var backAddr = document.querySelector('.flip-card-back .font-mono');
  if(backAddr) backAddr.textContent = short;

  var walletAddrPage = document.querySelector('#page-wallet-address .font-mono');
  if(walletAddrPage) walletAddrPage.textContent = addr;

  var depAddrText = $('cxDepAddrText'); if(depAddrText) depAddrText.textContent = addr;
  var depAddr = $('cxDepAddr'); if(depAddr) depAddr.textContent = addr;

  generateRealQR('cxDepQr', addr);
}

/* ── 18. GLOBAL REFRESH ── */
function globalRefresh(){
  return Promise.all([fetchAllBalances(), fetchPrices()]).then(function(){
    if(typeof updateActiveChainView==='function'){ try{updateActiveChainView('bot');}catch(e){} }
    updateWalletUI();
    renderTxHistory();
  });
}

/* ── 19. RENDER TX HISTORY ── */
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
    if(tx.type==='send'){ icon='↑'; typeLabel='Sent'; amtPrefix='-'; color='#ef4444'; bg='#fef2f2'; addrStr=tx.to?'To '+shortAddr(tx.to):''; }
    else if(tx.type==='receive'){ icon='↓'; typeLabel='Received'; amtPrefix='+'; color='#22c55e'; bg='#f0fdf4'; addrStr=tx.from?'From '+shortAddr(tx.from):''; }
    else if(tx.type==='gift_sent'){ icon='🎁'; typeLabel='Gift Sent'; amtPrefix='-'; color='#a855f7'; bg='#faf5ff'; addrStr=tx.to?'To '+shortAddr(tx.to):''; }
    else if(tx.type==='gift_claimed'){ icon='🎁'; typeLabel='Gift Claimed'; amtPrefix='+'; color='#22c55e'; bg='#f0fdf4'; addrStr=tx.from?'From '+shortAddr(tx.from):''; }
    else { icon='•'; typeLabel='Transaction'; amtPrefix=''; color='#6b7280'; bg='#f9fafb'; }
    var statusDot = tx.status==='confirmed' ? '<span style="color:#22c55e;font-size:10px">●</span>' : '<span style="color:#ef4444;font-size:10px">●</span>';
    var hashShort = tx.hash ? tx.hash.slice(0,10)+'...' : '';
    html += '<div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border-radius:14px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.04)" onclick="window.cxOpenTxDetail && window.cxOpenTxDetail('+i+')">'+
      '<div style="width:40px;height:40px;border-radius:12px;background:'+bg+';display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">'+icon+'</div>'+
      '<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:13px;font-weight:700;color:#1a1a1a">'+typeLabel+'</span>'+
      '<span style="font-size:13px;font-weight:800;color:'+color+'">'+amtPrefix+fmt(tx.amount)+' '+(tx.token||'BOT')+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px"><span style="font-size:11px;color:#9ca3af">'+addrStr+(hashShort?' · '+hashShort:'')+'</span>'+
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
    '<div style="width:56px;height:56px;border-radius:16px;background:'+(tx.type==='send'||tx.type==='gift_sent'?'#fef2f2':'#f0fdf4')+';display:flex;align-items:center;justify-content:center;font-size:24px;margin:0 auto 12px">'+(tx.type==='gift_sent'||tx.type==='gift_claimed'?'🎁':(tx.type==='send'?'↑':'↓'))+'</div>'+
    '<div style="font-size:13px;font-weight:700;color:#9ca3af;margin-bottom:4px">'+typeLabel+'</div>'+
    '<div style="font-size:28px;font-weight:900;color:'+color+'">'+((tx.type==='send'||tx.type==='gift_sent')?'-':'+')+fmt(tx.amount)+' '+(tx.token||'BOT')+'</div>'+
    '<div style="font-size:13px;color:#9ca3af;margin-top:4px">'+(BOT_PRICE_USD>0?'≈ $'+(tx.amount*BOT_PRICE_USD).toFixed(2):'')+'</div>'+
    '</div>'+
    '<div style="background:#f9fafb;border-radius:14px;padding:16px;margin-top:8px">'+
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;color:#9ca3af;font-weight:600">Status</span><span style="font-size:12px;font-weight:700;color:'+(tx.status==='confirmed'?'#22c55e':'#ef4444')+'">'+(tx.status==='confirmed'?'Confirmed':'Failed')+'</span></div>'+
    (tx.to?'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;color:#9ca3af;font-weight:600">To</span><span style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">'+shortAddr(tx.to)+'</span></div>':'')+
    (tx.from?'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;color:#9ca3af;font-weight:600">From</span><span style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">'+shortAddr(tx.from)+'</span></div>':'')+
    (tx.hash?'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6"><span style="font-size:12px;color:#9ca3af;font-weight:600">Hash</span><span style="font-size:12px;font-weight:700;color:#7c3aed;font-family:monospace;cursor:pointer" onclick="window.cxCopy(\''+tx.hash+'\',\'Hash copied\')">'+shortAddr(tx.hash)+' ↗</span></div>':'')+
    (tx.gasUsed?'<div style="display:flex;justify-content:space-between;padding:8px 0"><span style="font-size:12px;color:#9ca3af;font-weight:600">Gas Fee</span><span style="font-size:12px;font-weight:700;color:#1a1a1a">'+tx.gasUsed+' BOT</span></div>':'')+
    '<div style="display:flex;justify-content:space-between;padding:8px 0"><span style="font-size:12px;color:#9ca3af;font-weight:600">Time</span><span style="font-size:12px;font-weight:700;color:#1a1a1a">'+new Date(tx.timestamp).toLocaleString()+'</span></div>'+
    '</div>'+
    (tx.hash?'<button style="width:100%;margin-top:16px;padding:14px;background:#1a1a1a;color:#fff;border:none;border-radius:14px;font-size:14px;font-weight:800;cursor:pointer" onclick="window.open(\''+BOT_EXPLORER+'/tx/'+tx.hash+'\',\'_blank\')">View on Explorer ↗</button>':'');
  navigateTo('page-tx-detail');
};

/* ── 20. REAL GIFT REDEEM ── */
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

/* ── 21. AUTO-INIT ── */
function autoInit(){
  try {
    var existed = loadWallet();
    if(existed){
      initProvider();
      replaceAddresses();
      console.log('[WalletEngine] Loaded existing wallet:',walletData.address);
    } else {
      console.log('[WalletEngine] No wallet found');
    }
    wireRealFunctions();
    setTimeout(function(){
      if(walletData){
        Promise.all([fetchAllBalances(), fetchPrices()]).then(function(){
          if(typeof updateActiveChainView==='function'){ try{updateActiveChainView('bot');}catch(e){} }
          updateWalletUI();
          renderTxHistory();
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
  } catch(e){ console.error('[WalletEngine] autoInit error', e); }
}

/* ── PUBLIC API ── */
window.WalletEngine = {
  loadWallet:loadWallet, createWallet:createWallet, importFromMnemonic:importFromMnemonic,
  createReal:createReal, importReal:importReal, logoutWallet:logoutWallet,
  saveProfile:saveProfile, getProfile:getProfile,
  getAddress:function(){return walletData?walletData.address:null;},
  getShortAddress:function(){return walletData?shortAddr(walletData.address):'';},
  getPrivateKey:function(){return walletData?walletData.privateKey:null;},
  getMnemonic:function(){return walletData?walletData.mnemonic:null;},
  fetchBOTBalance:fetchBOTBalance, fetchAllBalances:fetchAllBalances, fetchPrices:fetchPrices,
  estimateGasFee:estimateGasFee,
  realSend:realSend, realGiftSend:realGiftSend, realGiftClaim:realGiftClaim, readGiftData:readGiftData,
  redeemGiftCode:redeemGiftCode,
  generateRealQR:generateRealQR, addBotToMetaMask:addBotToMetaMask,
  updateWalletUI:updateWalletUI, globalRefresh:globalRefresh,
  getTxHistory:getTxHistory, addTx:addTx, renderTxHistory:renderTxHistory,
  getGiftCodes:getGiftCodes, saveGiftCode:saveGiftCode, lookupGiftCode:lookupGiftCode,
  isInitialized:function(){return !!walletData;},
  getBOTPrice:function(){return BOT_PRICE_USD;},
  hasWallet:function(){return !!localStorage.getItem(STORAGE_KEY);},
  SBT_ADDRESS:SBT_ADDRESS, BOT_RPC:BOT_RPC, BOT_CHAIN_ID:BOT_CHAIN_ID, BOT_EXPLORER:BOT_EXPLORER
};

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',autoInit);}else{autoInit;}

})();
