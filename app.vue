<script setup lang="ts">
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

const route = useRoute();
const config = useRuntimeConfig();
let supabase: SupabaseClient;
const rooms = ['Lounge', 'Jogatina', 'Ranked'];
const currentRoom = ref(rooms.includes(String(route.query.room)) ? String(route.query.room) : rooms[0]);
const room = computed(() => currentRoom.value.toUpperCase());
const connected = ref(false);
const setupMissing = ref(false);
const sharing = ref(false);
const hasRemoteStream = ref(false);
const participantCount = ref(1);
const remoteVideo = ref<HTMLVideoElement>();
const previewVideo = ref<HTMLVideoElement>();
const channel = ref<RealtimeChannel>();
const stream = ref<MediaStream>();
const peers = new Map<string, RTCPeerConnection>();
const members = ref<{ id: string; animal: string }[]>([]);
const roomMembers = ref<Record<string, { id: string; animal: string }[]>>({});
const channels = new Map<string, RealtimeChannel>();
let id = '';
const animals = ['Raposa', 'Lobo', 'Urso', 'Panda', 'Tigre', 'Leão', 'Coala', 'Coruja', 'Gato', 'Cervo', 'Lontra', 'Macaco'];
const animal = ref(animals[Math.floor(Math.random() * animals.length)]);

function send(to: string, data: unknown) { channel.value?.send({ type: 'broadcast', event: 'signal', payload: { to, from: id, data } }); }
function updateMembers(name: string, current: RealtimeChannel) {
  const state = current.presenceState<{ animal: string }>();
  const list = Object.entries(state).map(([memberId, values]) => ({ id: memberId, animal: values[0]?.animal || 'Animal' }));
  roomMembers.value = { ...roomMembers.value, [name]: list };
  if (name === currentRoom.value) { members.value = list; participantCount.value = list.length || 1; }
}

function connect(peer: string, offer: boolean) {
  if (peers.has(peer)) return peers.get(peer)!;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peers.set(peer, pc);
  stream.value?.getTracks().forEach(track => pc.addTrack(track, stream.value!));
  pc.onicecandidate = event => event.candidate && send(peer, { candidate: event.candidate });
  pc.ontrack = event => { if (remoteVideo.value) { remoteVideo.value.srcObject = event.streams[0]; remoteVideo.value.style.display = 'block'; hasRemoteStream.value = true; } };
  pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { peers.delete(peer); updateMembers(room.value, channel.value!); } };
  if (offer) pc.createOffer().then(description => pc.setLocalDescription(description).then(() => send(peer, { description: pc.localDescription })));
  updateMembers(room.value, channel.value!);
  return pc;
}

async function signal(peer: string, data: any) {
  const pc = connect(peer, false);
  if (data.description) {
    await pc.setRemoteDescription(data.description);
    if (data.description.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); send(peer, { description: pc.localDescription }); }
  } else if (data.candidate) await pc.addIceCandidate(data.candidate);
}

async function startSharing() {
  if (!navigator.mediaDevices?.getDisplayMedia) return alert('Use Chrome, Edge ou Firefox para transmitir a tela.');
  try {
    stream.value = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (previewVideo.value) previewVideo.value.srcObject = stream.value;
    sharing.value = true;
    peers.forEach(async (pc, peer) => {
      stream.value!.getTracks().forEach(track => pc.addTrack(track, stream.value!));
      await pc.setLocalDescription(await pc.createOffer());
      send(peer, { description: pc.localDescription });
    });
    stream.value.getVideoTracks()[0].addEventListener('ended', stopSharing);
  } catch (error: any) { if (error.name !== 'NotAllowedError') alert('Nao foi possivel iniciar a transmissao.'); }
}

function stopSharing() { stream.value?.getTracks().forEach(track => track.stop()); stream.value = undefined; sharing.value = false; }
async function copyInvite() { await navigator.clipboard?.writeText(`${location.origin}?room=${room.value}`); }

onMounted(() => {
  if (!config.public.supabaseUrl || !config.public.supabaseAnonKey) { setupMissing.value = true; return; }
  supabase = createClient(config.public.supabaseUrl, config.public.supabaseAnonKey);
  id = crypto.randomUUID();
  rooms.forEach(name => setupRoom(name));
});
onBeforeUnmount(() => { stopSharing(); peers.forEach(peer => peer.close()); channels.forEach(current => current.unsubscribe()); });

function setupRoom(name: string) {
  const current = supabase.channel(`room:${name.toUpperCase()}`, { config: { broadcast: { self: false }, presence: { key: id } } });
  channels.set(name, current);
  current.on('broadcast', { event: 'signal' }, async ({ payload }) => { if (name === currentRoom.value && payload.to === id) await signal(payload.from, payload.data); });
  current.on('presence', { event: 'sync' }, () => { updateMembers(name, current); if (name === currentRoom.value) Object.keys(current.presenceState()).filter(peer => peer !== id).forEach(peer => connect(peer, id > peer)); });
  current.on('presence', { event: 'join' }, () => updateMembers(name, current));
  current.on('presence', { event: 'leave' }, ({ key }) => { if (name === currentRoom.value) { peers.get(key)?.close(); peers.delete(key); } updateMembers(name, current); });
  current.subscribe(async status => { if (status === 'SUBSCRIBED') { if (name === currentRoom.value) { channel.value = current; connected.value = true; await current.track({ animal: animal.value }); } updateMembers(name, current); } });
}

async function switchRoom(name: string) {
  if (name === currentRoom.value) return;
  stopSharing(); hasRemoteStream.value = false; if (remoteVideo.value) remoteVideo.value.srcObject = null; peers.forEach(peer => peer.close()); peers.clear(); await channel.value?.untrack(); members.value = [];
  currentRoom.value = name;
  await navigateTo({ query: { room: name } }, { replace: true });
  channel.value = channels.get(name);
  if (channel.value) { await channel.value.track({ animal: animal.value }); updateMembers(name, channel.value); }
}
</script>

<template>
  <main class="app">
    <nav class="servers"><button class="server active">P</button><button class="server">+</button><span class="line" /><button class="server add">+</button></nav>
    <aside class="sidebar"><header class="brand"><strong>Playroom</strong><small>● {{ connected ? 'conectado' : 'conectando...' }}</small></header><section class="section"><div class="label">Salas de voz</div><template v-for="name in rooms" :key="name"><button class="friend" :class="{ selected: name === currentRoom }" @click="switchRoom(name)"><span class="room-icon">◖</span><span class="friend-info"><strong>{{ name }}</strong><small>{{ roomMembers[name]?.length || 0 }} conectados</small></span></button><div v-if="roomMembers[name]?.length" class="room-members"><div v-for="member in roomMembers[name]" :key="member.id" class="room-member"><span class="member-dot" />{{ member.animal }}</div></div></template></section><footer class="profile"><span class="avatar orange">{{ animal[0] }}</span><span class="profile-info"><strong>{{ animal }}</strong><small>online</small></span><button class="settings">⚙</button></footer></aside>
    <section class="main"><header class="topbar"><h1>{{ currentRoom }}</h1><span class="connection" :class="{ error: setupMissing }">● {{ connected ? 'conexão segura' : setupMissing ? 'configure o Supabase' : 'conectando...' }}</span></header><div class="hero"><div class="mark">▶</div><h2>Jogue com seus amigos</h2><p>Você está na sala <strong>{{ currentRoom }}</strong>. Compartilhe sua tela quando quiser.</p></div><div v-if="setupMissing" class="setup-warning"><strong>Falta configurar a conexão.</strong><span>Adicione <code>NUXT_PUBLIC_SUPABASE_URL</code> e <code>NUXT_PUBLIC_SUPABASE_ANON_KEY</code> nas variáveis da Vercel e faça um novo deploy.</span></div><section class="room"><div class="room-head"><h3>{{ currentRoom }}</h3><span>{{ participantCount }} participante{{ participantCount === 1 ? '' : 's' }}</span></div><div class="room-code"><span>Convite da sala: <strong>{{ room }}</strong></span><button class="copy" @click="copyInvite">Copiar convite</button></div><div class="screen"><video v-show="sharing" ref="previewVideo" autoplay muted playsinline /><video v-show="hasRemoteStream" ref="remoteVideo" autoplay playsinline /><div v-if="!sharing && !hasRemoteStream" class="screen-content"><div class="screen-icon">▣</div><p>Ninguém está transmitindo agora</p><button class="primary" @click="startSharing">Transmitir minha tela</button></div><button v-if="sharing" class="stop" @click="stopSharing">Parar transmissão</button></div><div class="participants"><span v-for="member in members" :key="member.id" class="participant"><span class="avatar mini">{{ member.animal[0] }}</span>{{ member.animal }}</span></div></section><p class="hint">Cada pessoa recebe um animal aleatório ao entrar. Troque de sala pelo menu lateral.</p></section>
  </main>
</template>

<style scoped>
.connection.error { color: #fbbf24; }
.setup-warning { display: flex; flex-direction: column; gap: 5px; margin: -18px 0 24px; padding: 14px 16px; border: 1px solid #6b4d20; border-radius: 9px; background: #2a2113; color: #f8d58a; }
.setup-warning span { color: #d6bd80; font-size: 13px; }
.setup-warning code { color: #fff0bd; }
.room-icon { width: 18px; color: var(--muted); font-size: 20px; }
.room-members { padding: 0 12px 8px 39px; color: var(--muted); font-size: 12px; }
.room-member { display: flex; align-items: center; gap: 7px; padding: 4px 0; }
.member-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
</style>
