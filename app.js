
// ==========================
// Supabase init
// ==========================
const SUPABASE_URL = 'https://alhlaayihpqokkpoawyp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsaGxhYXlpaHBxb2trcG9hd3lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA1NDkxOTUsImV4cCI6MjA3NjEyNTE5NX0.l1PtKzWo2NTZ_unUle7Q-D0StPF_kkorn0taOxwmgpg';
const supabase = window.supabase.createClient(
  SUPABASE_URL, SUPABASE_ANON_KEY, {
    persistSession: true,
    autoRefreshToken: true
  }
);


// ---- Auth tab switching ----
document.addEventListener('DOMContentLoaded', () => {
  const authTabs = document.querySelector('.auth-tabs');
  const tabSignIn = document.getElementById('tabSignIn');
  const tabRegister = document.getElementById('tabRegister');

  // Panels are already marked up with data-panel="signin" / "register"
  const panels = document.querySelectorAll('.auth-panel');
  const title  = document.getElementById('auth-title');

  if (!authTabs || !tabSignIn || !tabRegister || panels.length === 0) return;

  function activate(which){
    // move the pill (works via :has(...) and the data-active fallback below)
    authTabs.dataset.active = which;

    // toggle active states on tabs
    tabSignIn.classList.toggle('is-active', which === 'signin');
    tabRegister.classList.toggle('is-active', which === 'register');

    // show/hide panels
    panels.forEach(p => {
      const isTarget = p.dataset.panel === which;
      p.hidden = !isTarget;
      p.classList.toggle('is-active', isTarget);
    });

    // update heading (optional)
    if (title) {
      title.textContent = which === 'signin' ? 'Good morning' : 'Create your rider account';
    }

    // a11y: reflect selection state
    tabSignIn.setAttribute('aria-selected', String(which === 'signin'));
    tabRegister.setAttribute('aria-selected', String(which === 'register'));
    tabSignIn.setAttribute('tabindex', which === 'signin' ? '0' : '-1');
    tabRegister.setAttribute('tabindex', which === 'register' ? '0' : '-1');
  }

  // default view
  activate('signin');

  // click handlers
  tabSignIn.addEventListener('click', () => activate('signin'));
  tabRegister.addEventListener('click', () => activate('register'));

  // optional: arrow key navigation between tabs
  authTabs.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const current = tabSignIn.classList.contains('is-active') ? 'signin' : 'register';
      const next = (current === 'signin') === (e.key === 'ArrowRight') ? 'register' : 'signin';
      activate(next);
      (next === 'signin' ? tabSignIn : tabRegister).focus();
      e.preventDefault();
    }
  });
});


// =========================
// PAYMENT 
// ==========================
// Ensure your Supabase client is created once with session persistence

let stripe, elements, cardElement;

async function initStripe() {
  if (stripe) return;
  stripe = Stripe('pk_test_XXXXXXXXXXXXXXXX'); // publishable key
  elements = stripe.elements();
  cardElement = elements.create('card');
  cardElement.mount('#card-element');
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('listener attached');
  const form = document.getElementById('paymentForm');
  form?.addEventListener('submit', onSavePayment);

  // Example: open modal elsewhere
  document.getElementById('editPaymentBtn')?.addEventListener('click', async () => {
    await initStripe();                 // ensure Stripe element exists
    document.getElementById('modalPayment').showModal();
  });
});

async function onSavePayment(e) {
  e.preventDefault();
  const payError = document.getElementById('payError'); 
  payError.textContent = '';

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { payError.textContent = 'Please sign in.'; return; }

  // 1) Get setup intent
  const siResp = await fetch(`${SUPABASE_URL}/functions/v1/create-setup-intent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  const siJson = await siResp.json();
  if (!siResp.ok) { payError.textContent = siJson.error || 'Failed to create setup intent'; return; }

  // 2) Confirm in browser (Stripe Elements does the PCI-safe collection)
  const billing_email = (document.getElementById('payEmail').value || '').trim();
  const { setupIntent, error: sErr } = await stripe.confirmCardSetup(siJson.client_secret, {
    payment_method: {
      card: cardElement,
      billing_details: { email: billing_email || undefined }
    }
  });
  if (sErr) { payError.textContent = sErr.message; return; }
  if (setupIntent.status !== 'succeeded') { payError.textContent = 'Card confirmation did not succeed.'; return; }

  // 3) Save in DB (server pulls brand/last4/exp from Stripe and sets user_id)
  const saveResp = await fetch(`${SUPABASE_URL}/functions/v1/save-payment-method`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payment_method_id: setupIntent.payment_method,
      billing_email
    })
  });

  const saveJson = await saveResp.json();
  if (!saveResp.ok) { payError.textContent = saveJson.error?.message || 'Failed to save payment method'; return; }

  document.getElementById('modalPayment').close();
  showToast?.('Payment method saved.');
  await renderRider(); // refresh UI: now you can show •••• last4, etc.
}

// expose opener if you need it on a button
window.openPaymentModal = openPaymentModal;



async function openPaymentModal() {
  await initStripe();
  document.getElementById('modalPayment').showModal();
}

// ==========================
// Simple state
// ==========================
const state = {
  user: null,            // { id, role, email, name, phone }
  focusedBusId: null,
  buses: [],             // { id, x:lat, y:lng }
  pickups: []
};

// ==========================
// Intl / helpers
// ==========================
const ngn = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
function escapeHtml(s=''){ return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function isoToday(){ return new Date().toISOString().slice(0,10); } // YYYY-MM-DD (UTC)


// ==========================
/* Elements */
// ==========================
const els = {
  
  // views
  login: document.getElementById('view-login'),
  liveRoute: document.getElementById('view-liveRoute'),
  account: document.getElementById('view-account'),
  driver: document.getElementById('view-driver'),
  admin: document.getElementById('view-admin'),
  reForm: document.getElementById('view-reForm'),

  
  // nav
  liveRouteBtn: document.getElementById('liveRouteBtn'),
  accountBtn: document.getElementById('accountBtn'),
  reFormBtn: document.getElementById('reFormBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
 

  // rider
  riderAccount: document.getElementById('riderAccount'),
  paymentInfo: document.getElementById('paymentInfo'),
  assignedBusLabel: document.getElementById('assignedBusLabel'),
  canvasRider: document.getElementById('canvasRider'),
  lastUpdateRider: document.getElementById('lastUpdateRider'),


  // driver
  driverPickups: document.getElementById('driverPickups'),
  driverProfile: document.getElementById('driverProfile'),
  canvasDriver: document.getElementById('canvasDriver'),
  driverBusLabel: document.getElementById('driverBusLabel'),
  lastUpdateDriver: document.getElementById('lastUpdateDriver'),

  // admin
  canvasAdmin: document.getElementById('canvasAdmin'),
  lastUpdateAdmin: document.getElementById('lastUpdateAdmin'),
  adminBusTable: document.getElementById('adminBusTable'),
  adminPickups: document.getElementById('adminPickups'),

  // modals
  editAccountBtn: document.getElementById('editAccountBtn'),
  editPaymentBtn: document.getElementById('editPaymentBtn'),
  modalAccount: document.getElementById('modalAccount'),
  modalPayment: document.getElementById('modalPayment'),
  accName: document.getElementById('accName'),
  accPhone: document.getElementById('accPhone'),
  payCard: document.getElementById('payCard'),
  payEmail: document.getElementById('payEmail'),
  saveAccount: document.getElementById('saveAccount'),
  savePayment: document.getElementById('savePayment'),
  themeBtn: document.getElementById('themeBtn'),
  
  // Auth tabs + forms
  authTabs: document.querySelector('.auth-tabs'),
  tabSignIn: document.getElementById('tabSignIn'),
  tabRegister: document.getElementById('tabRegister'),
  registerForm: document.getElementById('registerForm'),
  registerBtn: document.getElementById('registerBtn'),

};

// ==========================
// Careers data
// ==========================
const careers = [
  { role:'Data Engineer', monthly:250_000, location:'Ibadan, Nigeria',
    benefits:['HMO health coverage (employee + 1 dependent)','Pension (employer 10%, employee 8%)','Paid time off (15–20 days)','Laptop & equipment stipend','Monthly data/airtime stipend','Learning budget'] },
  { role:'Driver', monthly:200_000, location:'Ibadan, Nigeria',
    benefits:['HMO health coverage','Pension (statutory contribution)','Uniform & safety gear','Route/transport allowance','Overtime pay eligibility','Paid time off'] },
  { role:'Marketing Specialist', monthly:200_000, location:'Ibadan, Nigeria',
    benefits:['HMO health coverage','Pension (statutory contribution)','Monthly data/airtime stipend','Performance bonus eligibility','Paid time off'] },
  { role:'Creative Director', monthly:200_000, location:'Ibadan, Nigeria',
    benefits:['HMO health coverage','Pension (statutory contribution)','Equipment stipend','Monthly data/airtime stipend','Paid time off'] },
];

// ==========================
// Auth: login/logout
// ==========================
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    // 1) Auth
    const { data: signIn, error: sErr } = await supabase.auth.signInWithPassword({ email, password });
    if (sErr) { showToast?.(sErr.message || 'Sign-in failed'); return; }

    const userId = signIn.user.id;

    // 2) Profile (role now, not role)
    const { data: profile, error: pErr } = await supabase
      .from('user_profiles')
      .select('role, first_name, last_name, phone')
      .eq('id', userId)
      .maybeSingle();

    if (pErr) { console.error(pErr); showToast?.('Could not load profile'); return; }
    if (!profile) { showToast?.('Profile not found'); return; }

    const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || email;

    // 3) Save minimal state
    state.user = {
      id: userId,
      role: profile.role || 'rider',   // enum values: 'rider' | 'driver' | 'admin'
      email,
      name: displayName,
      phone: profile.phone || ''
    };

    // 4) UI bits + route
    if (els.logoutBtn) els.logoutBtn.hidden = false;

    // go to correct home for role
    await routeTo(state.user.role);

    showToast?.(`Welcome ${displayName.split(' ')[0]}!`);
  } catch (ex) {
    console.error('login fatal:', ex);
    showToast?.(ex?.message || 'Unexpected error during sign-in');
  }
});




els.logoutBtn.addEventListener('click', async ()=>{
  await supabase.auth.signOut();
  state.user = null;
  els.logoutBtn.hidden = true;
  stopLoops();
  showOnly(els.login);
});

// ---- Register (rider-only) ----
els.registerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const first_name   = document.getElementById('regFirst').value.trim();
  const last_name    = document.getElementById('regLast').value.trim();
  const email        = document.getElementById('regEmail').value.trim();
  const password     = document.getElementById('regPassword').value;
  const phone        = document.getElementById('regPhone').value.trim();
  const home_address = document.getElementById('regAddress').value.trim();
  const nin          = document.getElementById('regNIN').value.trim();

  // basic client-side checks
  if (!first_name || !last_name) { showToast?.('Enter first & last name'); return; }
  if (nin && !/^[0-9]{11}$/.test(nin)) { showToast?.('NIN must be 11 digits'); return; }

  els.registerBtn.disabled = true;
  els.registerBtn.textContent = 'Creating…';

  try {
    // 1) Auth sign-up
    const { data: signUp, error: sErr } = await supabase.auth.signUp({
      email, password
      // If you need email redirect: , options:{ emailRedirectTo: 'https://yourapp.com/...' }
    });
    if (sErr) { showToast?.(sErr.message || 'Sign up failed'); console.error(sErr); return; }

    const user = signUp.user;
    // If your project requires email confirmation, session may be null here.
    // We’ll attempt profile creation only if `user` exists.
    if (!user) {
      showToast?.('Check your email to confirm your account.');
      return;
    }


    // 2) Create profile row with role='rider'
    const { error: pErr } = await supabase.from('user_profiles').insert([{
      id: user.id,
      role: 'rider',                       // enum value in your DB
      first_name, last_name, phone,
      home_address,
      national_identification_number: nin || null,
      created_at: new Date().toISOString()
    }]).select(); // shows constraint/enum/permission errors;
    if (pErr) { showToast?.('Profile setup failed'); console.error(pErr); return; }


    // 4) Done – the onAuthStateChange listener will route; show friendly message
    showToast?.('Welcome! Your account is ready.');
  } catch (err) {
    console.error('register fatal', err);
    showToast?.('Unexpected error during signup');
  } finally {
    els.registerBtn.disabled = false;
    els.registerBtn.textContent = 'Create rider account';
  }
});


// ==========================
// Header nav
// ==========================


// Top nav buttons -> shared views
els.liveRouteBtn?.addEventListener('click', async () => {
  showOnly(els.liveRoute);
  if (typeof initLiveRouteOnce === 'function') await initLiveRouteOnce();
});

els.accountBtn?.addEventListener('click', async () => {
  showOnly(els.account);
  await renderRider?.();
  await renderPassPanel?.();
});

els.reFormBtn?.addEventListener('click', () => {
  showOnly(els.reForm);
});



// ==========================
// Routing
// ==========================

// Safe showOnly
function showOnly(viewEl) {
  const views = [els.liveRoute, els.account, els.reForm, els.driver, els.admin, els.login];
  views.forEach(v => { if (v) v.hidden = (v !== viewEl); });
}


async function routeTo(role) {
  stopLoops(); // stop any live intervals/timeouts

  if (role === 'rider') {
    // LIVE ROUTE (new rider home)
    showOnly(els.liveRoute);
    // init map/overlays if needed
    if (typeof initLiveRouteOnce === 'function') await initLiveRouteOnce(); // idempotent initializer
    if (typeof startLiveRouteLoop === 'function') startLiveRouteLoop();      // replaces startRiderLoop()
    // (Optional) Preload account data so Account tab snaps open instantly later
    renderRider?.();
    renderPassPanel?.();
  } else if (role === 'driver') {
    // DRIVER (unchanged)
    renderDriver?.();
    showOnly(els.driver);
    await loadDriverPickups?.();
    await subscribeDriverPickups?.();
    startDriverLoop?.();
  } else if (role === 'admin') {
    // ADMIN (unchanged)
    renderAdmin?.();
    showOnly(els.admin);
    startAdminLoop?.();
  } else {
    // Fallback: treat unknown role as rider
    showOnly(els.liveRoute);
    if (typeof initLiveRouteOnce === 'function') await initLiveRouteOnce();
    if (typeof startLiveRouteLoop === 'function') startLiveRouteLoop();
  }
}






// ==========================
// Renderers
// ==========================

async function renderRider() {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) {
    els.riderAccount.innerHTML = `<div>Please sign in.</div>`;
    els.paymentInfo.innerHTML = ``;
    return;
  }

  // basic profile info (already in your state)
  const p = state.user || {};
  els.riderAccount.innerHTML = `
    <div><strong>Name:</strong> ${escapeHtml(p.name || '')}</div>
    <div><strong>Phone:</strong> ${escapeHtml(p.phone || '')}</div>
  `;

  // query the user_payment_method table
  const { data: methods, error } = await supabase
    .from('user_payment_methods')
    .select('*')
    .eq('user_id', user.id)
    .limit(1);

  if (error) {
    console.error('Payment method fetch failed:', error);
    els.paymentInfo.innerHTML = `<div>Error loading payment methods</div>`;
    return;
  }

  // conditional rendering
  if (!methods || methods.length === 0) {
    els.paymentInfo.innerHTML = `
      <div><strong>Card:</strong> You have no saved payment methods</div>
      <div><strong>Billing:</strong> You have no saved billing address</div>
    `;
  } else {
    const m = methods[0];
    els.paymentInfo.innerHTML = `
      <div><strong>Card:</strong> •••• •••• •••• ${escapeHtml(m.last4 || '****')}</div>
      <div><strong>Billing:</strong> ${escapeHtml(m.billing_email || p.email || '')}</div>
    `;
  }
}


function renderDriver(){
  const d = state.user || {};
  els.driverProfile.innerHTML = `
    <div><strong>Name:</strong> ${escapeHtml(d.name || '')}</div>
    <div><strong>Employee ID:</strong> DRV-7782</div>
    <div><strong>Phone:</strong> ${escapeHtml(d.phone || '')}</div>
    <div><strong>Bus:</strong> <span id="driverBusInline">—</span></div>
  `;
}

function renderAdmin(){
  els.adminBusTable.innerHTML = '';
  els.adminPickups.innerHTML = '';
  (state.buses || []).forEach(b=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${b.id}</td><td>—</td><td>On route</td>`;
    tr.addEventListener('click', ()=>{ state.focusedBusId = b.id; });
    els.adminBusTable.appendChild(tr);
  });
}



// ==========================
// Driver pickups: fetch + render + update
// ==========================
async function loadDriverPickups() {
  const userId = state.user?.id;
  if (!userId) return;

  // 1) Driver's bus
  const { data: busRow, error: busErr } = await supabase
    .from('buses')
    .select('id')
    .eq('driver_id', userId)
    .maybeSingle();
  if (busErr || !busRow) {
    els.driverPickups.innerHTML = `<li><div class="muted">No bus assigned yet.</div></li>`;
    return;
  }
  const busId = busRow.id;
  const inline = document.getElementById('driverBusInline'); if (inline) inline.textContent = busId;

  // 2) Routes for that bus
  const { data: routes, error: routeErr } = await supabase
    .from('routes')
    .select('id')
    .eq('bus_id', busId);
  if (routeErr || !routes?.length) {
    els.driverPickups.innerHTML = `<li><div class="muted">No route found for bus ${busId}.</div></li>`;
    return;
  }
  const routeIds = routes.map(r => r.id);

  // 3) Active assignments on those routes
  const { data: assigns, error: asgErr } = await supabase
  .from('assignments')
  .select(`
    id,
    rider_id,
    rider:user_profiles(first_name, last_name)
  `)
  .in('route_id', routeIds)
  .eq('active', true);
  if (asgErr || !assigns?.length) {
    els.driverPickups.innerHTML = `<li><div class="muted">No active assignments on this route.</div></li>`;
    return;
  }
  const assignmentIds = assigns.map(a => a.id);

  // 4) Today's pickups joined with stop info
  const { data: pickups, error: pErr } = await supabase
    .from('pickups')
    .select(`
      id,
      status,
      pickup_date,
      picked_at,
      stop:stops(name, seq),
      assignment_id
    `)
    .in('assignment_id', assignmentIds)
    .eq('pickup_date', isoToday())
    .order('seq', { foreignTable: 'stop', ascending: true }); // order by stop.seq

  if (pErr) {
    els.driverPickups.innerHTML = `<li><div class="muted">Error loading pickups.</div></li>`;
    return;
  }

  if (!pickups?.length) {
    els.driverPickups.innerHTML = `<li><div class="muted">No pickups scheduled for today.</div></li>`;
    return;
  }

  // 5) Render
  els.driverPickups.innerHTML = '';
  // Sort pickups in ascending order by stop sequence
  pickups.sort((a, b) => (a.stop?.seq ?? 0) - (b.stop?.seq ?? 0));
  pickups.forEach(pk => {
    const rider = assigns.find(a => a.id === pk.assignment_id)?.rider;
    const rdr = rider ? `${rider.first_name ?? ''} ${rider.last_name ?? ''}`.trim() : '—';
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="flex between center">
        <div>
          <div><strong>Stop ${pk.stop?.seq ?? '—'}:</strong> ${escapeHtml(pk.stop?.name ?? 'Unknown')}</div>
          <div class="tiny muted">Assignment: ${escapeHtml(std)}</div>

        </div>
        <div class="flex center gap">
          <span class="badge">${escapeHtml(pk.status)}</span>
          ${pk.status === 'picked'
            ? '<span class="tiny neon-green">✓</span>'
            : `<button class="btn btn--ghost" data-action="mark" data-id="${pk.id}">complete pick-up</button>`}
        </div>
      </div>
    `;
    els.driverPickups.appendChild(li);
  });

  // 6) Click handler to mark picked
  els.driverPickups.onclick = async (e) => {
    const btn = e.target.closest('button[data-action="mark"]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const { error: updErr } = await supabase
      .from('pickups')
      .update({ status: 'picked', picked_at: new Date().toISOString() })
      .eq('id', id);
    if (updErr) alert('Failed to update pickup status');
    await loadDriverPickups(); // optimistic refresh
  };
}

// (Optional) realtime for pickups
let driverPickupsChannel;
async function subscribeDriverPickups(){
  driverPickupsChannel?.unsubscribe?.();
  driverPickupsChannel = supabase.channel('driver_pickups_today')
    .on('postgres_changes', { event:'*', schema:'public', table:'pickups' }, async payload=>{
      const d = payload.new?.pickup_date || payload.old?.pickup_date;
      if (d === isoToday()) await loadDriverPickups();
    })
    .subscribe();
}

// ==========================
// Canvas helpers (maps)
// ==========================
function drawGrid(ctx, w, h){
  ctx.fillStyle = '#0b1222'; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle = '#20304a'; ctx.lineWidth = 1;
  for(let x=0; x<w; x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0; y<h; y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
}
function drawBus(ctx, bus, highlight=false){
  ctx.beginPath();
  ctx.arc(bus.x, bus.y, highlight?8:6, 0, Math.PI*2);
  ctx.fillStyle = highlight ? '#2dd4bf' : '#7c5cff';
  ctx.fill();
  ctx.font = '12px system-ui'; ctx.fillStyle = '#cfe1ff';
  ctx.fillText(bus.id, bus.x + 10, bus.y - 8);
}
// simple lon/lat -> canvas mapping (rough, adjust as needed)
function scaleX(lon){ return (lon - 2.5) * 300; }
function scaleY(lat){ return (8.8 - lat) * 300; } // invert so north is up

// ==========================
// Realtime loops (locations)
// ==========================
let riderLoop, driverLoop, adminLoop;
let riderChannel, driverChannel, adminChannel;

async function startRiderLoop(){
  const userId = state.user.id;
  const { data: routesForUser } = await supabase
    .from('assignments').select('route_id').eq('rider_id', userId).eq('active', true);
  if (!routesForUser?.length) return;

  const routeIds = routesForUser.map(r=>r.route_id);
  const { data: routes } = await supabase.from('routes').select('bus_id').in('id', routeIds);
  const busId = routes?.[0]?.bus_id;
  if (!busId) return;
  els.assignedBusLabel.textContent = `Assigned bus: ${busId}`;

  const { data: latest } = await supabase.from('bus_locations_latest').select('*').eq('bus_id', busId).maybeSingle();
  if (latest) upsertBus(busId, latest.lat, latest.lng);

  const canvas = els.canvasRider, ctx = canvas.getContext('2d');
  function draw(){
    drawGrid(ctx, canvas.width, canvas.height);
    const b = state.buses.find(x=>x.id===busId);
    if (b) drawBus(ctx, { x: scaleX(b.y), y: scaleY(b.x), id: busId }, true);
    els.lastUpdateRider.innerHTML = `<div class="muted">Last update: ${new Date().toLocaleTimeString()}</div>`;

    driverLoop = requestAnimationFrame(draw);
  }
  draw();

  riderChannel?.unsubscribe?.();
  riderChannel = supabase.channel(`rider_bus_${busId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bus_locations_latest', filter: `bus_id=eq.${busId}` },
      payload => {
        const rec = payload.new || payload.old;
        if (!rec) return;
        upsertBus(busId, rec.lat, rec.lng);
      }
    ).subscribe();
}

async function startDriverLoop(){
  const userId = state.user.id;
  const { data: myBus } = await supabase.from('buses').select('id').eq('driver_id', userId).maybeSingle();
  const busId = myBus?.id;
  if (!busId) return;
  els.driverBusLabel.textContent = `Bus: ${busId}`;
  const inline = document.getElementById('driverBusInline'); if (inline) inline.textContent = busId;

  const { data: latest } = await supabase.from('bus_locations_latest').select('*').eq('bus_id', busId).maybeSingle();
  if (latest) upsertBus(busId, latest.lat, latest.lng);

  const canvas = els.canvasDriver, ctx = canvas.getContext('2d');
  function draw(){
    drawGrid(ctx, canvas.width, canvas.height);
    const b = state.buses.find(x=>x.id===busId);
    if (b) drawBus(ctx, { x: scaleX(b.y), y: scaleY(b.x), id: busId }, true);
    els.lastUpdateDriver.textContent = 'Last update: ' + new Date().toLocaleTimeString();
    driverLoop = requestAnimationFrame(draw);
  }
  draw();

  driverChannel?.unsubscribe?.();
  driverChannel = supabase.channel(`driver_bus_${busId}`)
    .on('postgres_changes', { event:'*', schema:'public', table:'bus_locations_latest', filter:`bus_id=eq.${busId}` },
      payload => {
        const rec = payload.new || payload.old;
        if (!rec) return;
        upsertBus(busId, rec.lat, rec.lng);
      }).subscribe();

}

async function startAdminLoop(){
  const { data: allLatest } = await supabase.from('bus_locations_latest').select('*');
  (allLatest || []).forEach(rec=> upsertBus(rec.bus_id, rec.lat, rec.lng));

  els.adminBusTable.innerHTML = '';
  state.buses.forEach(b=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${b.id}</td><td>—</td><td>On route</td>`;
    tr.addEventListener('click', ()=>{ state.focusedBusId = b.id; });
    els.adminBusTable.appendChild(tr);
  });

  const canvas = els.canvasAdmin, ctx = canvas.getContext('2d');
  function draw(){
    drawGrid(ctx, canvas.width, canvas.height);
    state.buses.forEach(b=>{
      const highlight = (state.focusedBusId === b.id);
      drawBus(ctx, { x: scaleX(b.y), y: scaleY(b.x), id: b.id }, highlight);
    });
    els.lastUpdateAdmin.textContent = 'Last update: ' + new Date().toLocaleTimeString();
    adminLoop = requestAnimationFrame(draw);
  }
  draw();

  adminChannel?.unsubscribe?.();
  adminChannel = supabase.channel('admin_buses_all')
    .on('postgres_changes', { event:'*', schema:'public', table:'bus_locations_latest' },
      payload=>{
        const rec = payload.new || payload.old;
        if (!rec) return;
        upsertBus(rec.bus_id, rec.lat, rec.lng);
      }
    ).subscribe();
}

// ==========================
// Loop/Subscription cleanup
// ==========================
function stopLoops(){
  if (riderLoop) cancelAnimationFrame(riderLoop);
  if (driverLoop) cancelAnimationFrame(driverLoop);
  if (adminLoop) cancelAnimationFrame(adminLoop);
  riderChannel?.unsubscribe?.();
  driverChannel?.unsubscribe?.();
  adminChannel?.unsubscribe?.();
  driverPickupsChannel?.unsubscribe?.();
}

// ==========================
// Data helpers
// ==========================
function upsertBus(id, lat, lng){
  const idx = state.buses.findIndex(b=>b.id===id);
  const bus = { id, x: lat, y: lng };
  if (idx>=0) state.buses[idx] = bus; else state.buses.push(bus);
}

// ==========================
// Toast Helper
// ==========================
function showToast(message, ms = 2600) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = `
  <span class="toast__icon">✓</span>
  <span class="toast__msg">${escapeHtml(message)}</span>`;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=> el.classList.remove('show'), ms);
}



// ==========================
// Modals (Rider)
// ==========================

els.editAccountBtn?.addEventListener('click', () => {
  document.getElementById('accFirst').value = state.user?.first_name || '';
  document.getElementById('accLast').value  = state.user?.last_name || '';
  els.accPhone.value = state.user?.phone || '';
  els.modalAccount.showModal();
});

els.editPaymentBtn?.addEventListener('click', async () => {
  await initStripe();       

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { showToast?.('Please sign in'); return; }

  const { data: methods, error } = await supabase
    .from('user_payment_methods')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) { console.error(error); showToast?.('Error fetching payment'); return; }

  const display = document.getElementById('payCardDisplay');
  if (display) {
    display.textContent = (methods?.length ? `•••• ${methods[0].last4}` : 'No card on file');
  }

  // Update billing email input
  const emailInput = document.getElementById('payEmail');
  if (emailInput) {
    if (methods && methods.length > 0 && methods[0].billing_email) {
      emailInput.value = methods[0].billing_email;
    } else {
      emailInput.value = ''; // or explicitly null if you prefer
    }
  }

  els.modalPayment.showModal();
});


els.saveAccount?.addEventListener('click', async () => {
  const first_name = document.getElementById('accFirst').value.trim();
  const last_name  = document.getElementById('accLast').value.trim() || null;
  const phone      = els.accPhone.value.trim();
  if (!state.user) return;

  const { error } = await supabase
    .from('user_profiles')
    .update({ first_name, last_name, phone })
    .eq('id', state.user.id);

  if (error) { alert('Failed to save'); return; }

  // Update local state + re-render rider panel
  state.user.first_name = first_name;
  state.user.last_name = last_name;
  state.user.name = [first_name, last_name].filter(Boolean).join(' ');
  state.user.phone = phone;
  renderRider();
});


els.savePayment?.addEventListener('click', ()=>{
  renderRider(); // stub for now
});


////////////////////////
//PLAN
// assumes you already created a Supabase client with persistSession: true
// ---------- PLAN ----------
const PASS_FN_URL = `${SUPABASE_URL}/functions/v1/start-pass`; // make sure SUPABASE_URL is defined



async function fetchPass() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, pass: null };

  const { data, error } = await supabase
    .from('v_rider_pass')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) console.error('fetchPass error:', error);
  return { user, pass: data };
}


async function renderPassPanel() {
  const panel = document.getElementById('passPanel');
  if (!panel) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    panel.innerHTML = `
      <div>Please sign in.</div>`;
    return;
  }

  const { data: pass, error } = await supabase
    .from('v_rider_pass')
    .select('user_id, plan_code, plan_name, next_billing_at, amount_ngn')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('fetchPass error:', error);
  }

  // Normalize (defensive even with the view patched)
  const planCode = pass?.plan_code ?? null;

  if (!pass || planCode === null || planCode === 'null' || planCode === '') {
    panel.innerHTML = `
      <div>You have no current plan</div>
      <div class="actions">
        <button id="choosePlanBtn" class="badge-btn" type="button">Choose plan</button>
      </div>`;
    document.getElementById('choosePlanBtn')?.addEventListener('click', openChoosePlanModal);
    return;
  }

  const next = pass.next_billing_at ? new Date(pass.next_billing_at) : null;
    panel.innerHTML = `
    <div class="plan-row">
      <div class="plan-name" style="font-weight:600">${pass.plan_name ?? planCode}</div>
      <div class="actions">
        <button id="editPlanBtn" class="badge-btn" type="button">Edit plan</button>
      </div>
    </div>
    <div class="muted">Next billing date: ${next.toLocaleDateString()}</div>
  `;
  document.getElementById('editPlanBtn')?.addEventListener('click', openChoosePlanModal);
}



async function onChoosePlanSubmit(e) {
  e.preventDefault();
  const err = document.getElementById('choosePlanError');
  const saveBtn = document.querySelector('#choosePlanForm button[type="submit"]');
  err.textContent = '';
  saveBtn?.setAttribute('disabled', 'true');
  if (saveBtn) saveBtn.textContent = 'Saving…';

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { err.textContent = 'Please sign in.'; return; }

    const form = e.target.tagName === 'FORM' ? e.target : e.currentTarget;

    if (!(form instanceof HTMLFormElement)) {
      console.error('Submit handler triggered but target is not a form:', e.target);
      err.textContent = 'Unexpected form error';
      return;
    }
    const plan_code = (new FormData(form).get('plan')) || 'MONTH_PASS';


    const resp = await fetch(`${SUPABASE_URL}/functions/v1/start-pass`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ plan_code })
    });

    let json = null, text = null;
    try { json = await resp.json(); } catch { text = await resp.text(); }

    if (!resp.ok) {
      const message = (json && json.error) || text || `HTTP ${resp.status}`;
      console.error('start-pass failed:', resp.status, message, { json, text });
      err.textContent = message;
      return;
    }

    document.getElementById('modalChoosePlan')?.close();
    showToast?.('Plan saved.');
    await renderPassPanel();
  } catch (ex) {
    console.error('onChoosePlanSubmit fatal:', ex);
    err.textContent = ex?.message || 'Unexpected error.';
  } finally {
    saveBtn?.removeAttribute('disabled');
    if (saveBtn) saveBtn.textContent = 'Save';
  }
}


// Attach listeners AFTER DOM is ready so the form exists
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('choosePlanForm');
  if (!form) {
    console.warn('#choosePlanForm not found at DOMContentLoaded');
  } else {
    form.addEventListener('submit', onChoosePlanSubmit);
    console.log('submit listener attached to #choosePlanForm');
  }

  renderPassPanel();
});

supabase.auth.onAuthStateChange((_event, _session) => {
  renderPassPanel();
});


const NGN = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });

function formatPlanRow(plan, isChecked) {
  const price = NGN.format(plan.amount_ngn ?? 0);
  const feature = plan.description || (plan.code.includes('PASS-5') ? 'Up to 5 rides daily' :
                                       plan.code.includes('PASS-2') ? 'Up to 2 rides daily' : '');
  const id = `plan-${plan.code.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}`;

  return `
    <label class="plan-option" for="${id}">
      <div class="plan-left">
        <div class="plan-title">${escapeHtml(plan.name || plan.code)}</div>
        <div class="plan-feature">${escapeHtml(feature)}</div>
        <div class="plan-price">${price} <span style="color:#6b7280;font-weight:400"> · ${escapeHtml(plan.billing_interval || '')}</span></div>
      </div>
      <div class="plan-right">
        <input id="${id}" type="radio" name="plan" value="${escapeHtml(plan.code)}" ${isChecked ? 'checked' : ''} />
      </div>
    </label>
  `;
}

/** Load plans from DB, preselect current user's plan if any, and render into #planList */
async function loadAndRenderPlans() {
  const list = document.getElementById('planList');
  const err  = document.getElementById('choosePlanError');
  if (!list) return;

  list.innerHTML = `<div style="color:#6b7280">Loading plans…</div>`;
  if (err) err.textContent = '';

  try {
    // 1) fetch all active plans
    const { data: plans, error: pErr } = await supabase
      .from('plans')
      .select('code,name,amount_ngn,billing_interval,description,active')
      .eq('active', true)
      .order('billing_interval', { ascending: true })
      .order('amount_ngn', { ascending: true });

    if (pErr) throw pErr;
    if (!plans || plans.length === 0) {
      list.innerHTML = `<div>No plans available.</div>`;
      return;
    }

    // 2) fetch user's current plan to preselect
    let currentCode = null;
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: passRow } = await supabase
        .from('riders')
        .select('subscription_plan_code')
        .eq('user_id', user.id)
        .maybeSingle();
      currentCode = passRow?.subscription_plan_code || null;
    }

    // 3) render
    list.innerHTML = plans.map((pl, idx) => formatPlanRow(pl, currentCode ? pl.code === currentCode : idx === 0)).join('');
  } catch (e) {
    console.error('loadAndRenderPlans failed:', e);
    list.innerHTML = `<div>Could not load plans.</div>`;
    if (err) err.textContent = e?.message || 'Failed to load plans';
  }
}

function openChoosePlanModal() {
  const dlg = document.getElementById('modalChoosePlan');
  if (!dlg) return;
  loadAndRenderPlans().finally(() => dlg.showModal());
}






//PAYMENT
////////////////////////

async function loadPaymentFromRiders() {
  // get current user
  const { data: authRes, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authRes?.user) {
    console.error('auth', authErr);
    return;
  }

  // read from riders table
  const { data: rider, error } = await supabase
    .from('riders')
    .select('billing_email, card_last4')
    .eq('user_id', authRes.user.id)
    .single();

  if (error) {
    console.error('riders select', error);
    return;
  }

  // fill inputs (fallback to empty if null)
  const cardInput  = document.getElementById('payCard');
  const emailInput = document.getElementById('payEmail');

  if (emailInput) emailInput.value = rider?.billing_email || '';
  if (cardInput)  cardInput.value  = rider?.card_last4 || ''; // last 4 only
}

async function savePaymentToRiders() {
  const { data: authRes } = await supabase.auth.getUser();
  const cardLast4 = document.getElementById('payCard')?.value?.trim() || null;
  const billing   = document.getElementById('payEmail')?.value?.trim() || null;

  const { error } = await supabase
    .from('riders')
    .update({
      billing_email: billing,
      card_last4: cardLast4
    })
    .eq('user_id', authRes.user.id);

  if (error) {
    console.error('rider update', error);
    showToast?.('Failed to save payment info');
    return;
  }
  showToast?.('Payment info saved');
}





// ==========================
// Session restore on load
// ==========================

(async ()=>{
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role, first_name, last_name, phone')
      .eq('id', user.id)
      .maybeSingle();
    if (profile) {
      state.user = { id: user.id, role: profile.role, email: user.email, name: profile.first_name || user.email, phone: profile.phone || '' };
      els.logoutBtn.hidden = false;
      goDashboard();
    }
  }
})();


// --- Leaflet map (background) ---
let map, busMarker, userMarker, routePolyline;
function initMap() {
  map = L.map('routeMap', { zoomControl:false }).setView([6.5244, 3.3792], 12); // Lagos-ish
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution:'&copy; OpenStreetMap'
  }).addTo(map);

  // Demo route + markers
  const demoRoute = [
    [6.527, 3.371], [6.526,3.375], [6.525,3.381], [6.524,3.389], [6.523,3.395]
  ];
  routePolyline = L.polyline(demoRoute, { color:'#4f46e5', weight:4 }).addTo(map);
  busMarker = L.circleMarker(demoRoute[2], { radius:7, color:'#4f46e5', fill:true, fillOpacity:.9 }).addTo(map);
  userMarker = L.circleMarker([6.523,3.389], { radius:6, color:'#111', fill:true, fillOpacity:.9 }).addTo(map);
  map.fitBounds(routePolyline.getBounds(), { padding:[40,40] });

  updateNextStopUI({
    name:'Adekunle – Yaba',
    eta:'5 min',
    list: [
      { name:'Iyana Oworo', tag:'prev 3m' },
      { name:'Third Mainland Link', tag:'prev 2m' },
      { name:'Adekunle – Yaba', tag:'next 5m' },
      { name:'Tejuosho', tag:'next 9m' },
    ]
  });
}

function updateNextStopUI({ name, eta, list }) {
  document.getElementById('nextStopName').textContent = name;
  document.getElementById('nextStopETA').textContent  = `ETA ${eta}`;
  const ul = document.getElementById('stopsList');
  ul.innerHTML = list.map(s => `
    <li><span>${s.name}</span><span class="tag">${s.tag}</span></li>
  `).join('');
}

// --- Floating menus ---
const stopMenuBtn = document.getElementById('stopMenuBtn');
const stopsPanel  = document.getElementById('stopsPanel');
stopMenuBtn.addEventListener('click', () => {
  const shown = !stopsPanel.hasAttribute('hidden');
  if (shown) stopsPanel.setAttribute('hidden','');
  else stopsPanel.removeAttribute('hidden');
});

// --- QR button (hook your QR modal here) ---
document.getElementById('qrBtn').addEventListener('click', () => {
  // open your QR pass modal / dialog
  alert('QR pass would open here');
});

// --- Bottom sheet drag + toggle ---
const sheet = document.getElementById('bottomSheet');
const handle = document.getElementById('sheetHandle');
let dragStartY = null, startExpanded = false;

function setSheetExpanded(expand) {
  sheet.classList.toggle('sheet--expanded', expand);
}
function toggleSheet() { setSheetExpanded(!sheet.classList.contains('sheet--expanded')); }

['mousedown','touchstart'].forEach(evt => handle.addEventListener(evt, (e) => {
  dragStartY = (e.touches?.[0]?.clientY ?? e.clientY);
  startExpanded = sheet.classList.contains('sheet--expanded');
}));

['mousemove','touchmove'].forEach(evt => window.addEventListener(evt, (e) => {
  if (dragStartY == null) return;
  const y = (e.touches?.[0]?.clientY ?? e.clientY);
  const dy = y - dragStartY;
  const threshold = 40; // pixels
  if (!startExpanded && dy < -threshold) { setSheetExpanded(true); dragStartY = null; }
  if (startExpanded && dy > threshold)  { setSheetExpanded(false); dragStartY = null; }
}));

['mouseup','touchend','touchcancel'].forEach(evt => window.addEventListener(evt, () => { dragStartY = null; }));
handle.addEventListener('click', toggleSheet);

// --- Address + Go + simulated ETA ---
const addressInput = document.getElementById('addressInput');
const etaValue     = document.getElementById('etaValue');

document.getElementById('goBtn').addEventListener('click', () => {
  const addr = (addressInput.value || '').trim();
  // Simulate geocode + ETA
  if (!addr) { etaValue.textContent = '—'; return; }
  // simple fake ETA based on length
  const minutes = Math.min(20, Math.max(3, Math.round(addr.length / 2)));
  etaValue.textContent = `${minutes} min`;
});

// --- Past rides (demo) ---
const rides = [
  { when:'Today 08:35',  stop:'Tejuosho',      vehicle:'BRT-212' },
  { when:'Yesterday 17:10', stop:'Adekunle – Yaba', vehicle:'BRT-198' },
  { when:'Oct 21, 12:05', stop:'Iyana Oworo',  vehicle:'BRT-156' },
];
function renderRides(){
  const ul = document.getElementById('ridesList');
  ul.innerHTML = rides.map(r => `<li><span>${r.when}</span><span>${r.stop} · ${r.vehicle}</span></li>`).join('');
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderRides();
});











