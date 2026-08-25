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
const connectionError = ref('');
const sharing = ref(false);
const left = ref(false);
const previewVideo = ref<HTMLVideoElement>();
const channel = ref<RealtimeChannel>();
const stream = ref<MediaStream>();
const peers = new Map<string, RTCPeerConnection>();
const members = ref<{ id: string; animal: string; room: string }[]>([]);
const roomMembers = ref<Record<string, { id: string; animal: string; room: string }[]>>({});
const remoteStreams = ref<Map<string, MediaStream>>(new Map());
const focusedPeer = ref<string | null>(null);
let id = '';
let userId = '';
const animals = ['Raposa', 'Lobo', 'Urso', 'Panda', 'Tigre', 'Leão', 'Coala', 'Coruja', 'Gato', 'Cervo', 'Lontra', 'Macaco'];
const animal = ref('Animal');

function send(to: string, data: unknown) {
  channel.value?.send({ type: 'broadcast', event: 'signal', payload: { to, from: id, room: currentRoom.value.toUpperCase(), data } });
}

function updateMembers(current: RealtimeChannel) {
  const state = current.presenceState<{ animal: string; room: string }>();
  const all = Object.entries(state).map(([memberId, values]) => ({
    id: memberId,
    animal: values[0]?.animal || 'Animal',
    room: values[0]?.room,
  }));
  roomMembers.value = Object.fromEntries(rooms.map(name => [name, all.filter(m => m.room === name.toUpperCase())]));
  members.value = roomMembers.value[currentRoom.value] || [];
}

function bindAllVideos() {
  nextTick(() => {
    document.querySelectorAll<HTMLElement>('[data-peer]').forEach(el => {
      const peerId = el.dataset.peer!;
      const s = remoteStreams.value.get(peerId);
      const video = el.querySelector('video');
      if (video && s && video.srcObject !== s) video.srcObject = s;
    });
  });
}

watch(remoteStreams, () => bindAllVideos(), { deep: true });
watch(focusedPeer, () => bindAllVideos());

function addStreamToPeer(pc: RTCPeerConnection) {
  if (!stream.value) return;
  const senders = pc.getSenders().filter(s => s.track?.kind === 'video');
  stream.value.getVideoTracks().forEach((track, i) => {
    if (senders[i]) senders[i].replaceTrack(track);
    else pc.addTrack(track, stream.value!);
  });
  const audioSenders = pc.getSenders().filter(s => s.track?.kind === 'audio');
  stream.value.getAudioTracks().forEach((track, i) => {
    if (audioSenders[i]) audioSenders[i].replaceTrack(track);
    else pc.addTrack(track, stream.value!);
  });
}

function connect(peer: string, offer: boolean) {
  if (peers.has(peer)) return peers.get(peer)!;
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peers.set(peer, pc);

  addStreamToPeer(pc);

  pc.onicecandidate = event => event.candidate && send(peer, { candidate: event.candidate });
  pc.ontrack = event => {
    const peerStream = event.streams[0];
    if (peerStream) {
      const next = new Map(remoteStreams.value);
      next.set(peer, peerStream);
      remoteStreams.value = next;
      if (!focusedPeer.value) focusedPeer.value = peer;
    }
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      peers.delete(peer);
      const next = new Map(remoteStreams.value);
      next.delete(peer);
      remoteStreams.value = next;
      if (focusedPeer.value === peer) focusedPeer.value = null;
    }
  };

  if (offer) {
    pc.createOffer().then(desc => pc.setLocalDescription(desc).then(() => send(peer, { description: pc.localDescription })));
  }
  updateMembers(channel.value!);
  return pc;
}

async function signal(peer: string, data: any) {
  const pc = connect(peer, false);
  if (data.description) {
    await pc.setRemoteDescription(data.description);
    if (data.description.type === 'offer') {
      await pc.setLocalDescription(await pc.createAnswer());
      send(peer, { description: pc.localDescription });
    }
  } else if (data.candidate) {
    await pc.addIceCandidate(data.candidate);
  }
}

async function startSharing() {
  if (!navigator.mediaDevices?.getDisplayMedia) return alert('Use Chrome, Edge ou Firefox para transmitir a tela.');
  try {
    stream.value = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (previewVideo.value) previewVideo.value.srcObject = stream.value;
    sharing.value = true;
    peers.forEach(async (pc, peer) => {
      addStreamToPeer(pc);
      await pc.setLocalDescription(await pc.createOffer());
      send(peer, { description: pc.localDescription });
    });
    stream.value.getVideoTracks()[0].addEventListener('ended', stopSharing);
  } catch (error: any) {
    if (error.name !== 'NotAllowedError') alert('Nao foi possivel iniciar a transmissao.');
  }
}

function stopSharing() {
  stream.value?.getTracks().forEach(track => track.stop());
  stream.value = undefined;
  sharing.value = false;
  focusedPeer.value = null;
}

function leaveRoom() {
  left.value = true;
  stopSharing();
  channel.value?.untrack();
  peers.forEach(pc => pc.close());
  peers.clear();
  remoteStreams.value = new Map();
  members.value = [];
}

async function rejoinRoom() {
  left.value = false;
  id = userId;
  focusedPeer.value = null;
  if (channel.value) {
    await channel.value.track({ animal: animal.value, room: currentRoom.value.toUpperCase() });
    updateMembers(channel.value);
    // Force reconnect with all peers in the room
    const state = channel.value.presenceState<{ room: string }>();
    Object.keys(state)
      .filter(peer => peer !== id && state[peer]?.[0]?.room === currentRoom.value.toUpperCase())
      .forEach(peer => connect(peer, id > peer));
  }
}

async function copyInvite() {
  await navigator.clipboard?.writeText(`${location.origin}?room=${room.value}`);
}

function focusPeer(peerId: string) {
  focusedPeer.value = focusedPeer.value === peerId ? null : peerId;
}

function toggleFullscreen(wrap: HTMLElement) {
  const target = wrap.querySelector('video') || wrap;
  if (document.fullscreenElement) document.exitFullscreen();
  else target.requestFullscreen();
}

onMounted(() => {
  if (!config.public.supabaseUrl || !config.public.supabaseAnonKey) {
    setupMissing.value = true;
    return;
  }
  supabase = createClient(config.public.supabaseUrl, config.public.supabaseAnonKey);
  userId = crypto.randomUUID();
  animal.value = animals[Math.floor(Math.random() * animals.length)];
  const current = supabase.channel('playroom', {
    config: { broadcast: { self: false }, presence: { key: userId } },
  });
  channel.value = current;

  current.on('broadcast', { event: 'signal' }, async ({ payload }) => {
    if (!left.value && payload.room === currentRoom.value.toUpperCase() && payload.to === id) {
      await signal(payload.from, payload.data);
    }
  });

  current.on('presence', { event: 'sync' }, () => {
    updateMembers(current);
    const state = current.presenceState<{ room: string }>();
    Object.keys(state)
      .filter(peer => peer !== id && state[peer]?.[0]?.room === currentRoom.value.toUpperCase())
      .forEach(peer => {
        if (!peers.has(peer)) connect(peer, id > peer);
      });
  });

  current.on('presence', { event: 'join' }, () => updateMembers(current));
  current.on('presence', { event: 'leave' }, ({ key }) => {
    peers.get(key)?.close();
    peers.delete(key);
    const next = new Map(remoteStreams.value);
    next.delete(key);
    remoteStreams.value = next;
    updateMembers(current);
  });

  current.subscribe(async (status, error) => {
    if (status === 'SUBSCRIBED') {
      connected.value = true;
      connectionError.value = '';
      id = userId;
      await current.track({ animal: animal.value, room: currentRoom.value.toUpperCase() });
      updateMembers(current);
    } else if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
      console.error('Supabase Realtime:', status, error);
      connectionError.value = `${status}${error?.message ? `: ${error.message}` : ''}`;
    }
  });
});

onBeforeUnmount(() => {
  stopSharing();
  peers.forEach(peer => peer.close());
  channel.value?.unsubscribe();
});

async function switchRoom(name: string) {
  if (name === currentRoom.value) return;
  stopSharing();
  peers.forEach(peer => peer.close());
  peers.clear();
  remoteStreams.value = new Map();
  await channel.value?.untrack();
  members.value = [];
  currentRoom.value = name;
  await navigateTo({ query: { room: name } }, { replace: true });
  id = userId;
  if (channel.value) {
    await channel.value.track({ animal: animal.value, room: name.toUpperCase() });
    updateMembers(channel.value);
  }
}
</script>

<template>
  <main class="app">
    <nav class="servers">
      <button class="server active">P</button>
      <button class="server">+</button>
      <span class="line" />
      <button class="server add">+</button>
    </nav>

    <aside class="sidebar">
      <header class="brand">
        <strong>Playroom</strong>
        <small>● {{ left ? 'fora da sala' : connected ? 'conectado' : 'conectando...' }}</small>
      </header>

      <section class="section">
        <div class="label">Salas de voz</div>
        <template v-for="name in rooms" :key="name">
          <button class="friend" :class="{ selected: name === currentRoom && !left }" @click="switchRoom(name)">
            <span class="room-icon">◖</span>
            <span class="friend-info">
              <strong>{{ name }}</strong>
              <small>{{ roomMembers[name]?.length || 0 }} conectados</small>
            </span>
          </button>
          <div v-if="roomMembers[name]?.length" class="room-members">
            <div v-for="member in roomMembers[name]" :key="member.id" class="room-member">
              <span class="member-dot" />{{ member.animal }}
            </div>
          </div>
        </template>
      </section>

      <footer class="profile">
        <span class="avatar orange">{{ animal[0] }}</span>
        <span class="profile-info">
          <strong>{{ animal }}</strong>
          <small>{{ left ? 'offline' : 'online' }}</small>
        </span>
        <button class="settings">⚙</button>
      </footer>
    </aside>

    <section class="main">
      <header class="topbar">
        <h1>{{ currentRoom }}</h1>
        <span class="connection" :class="{ error: setupMissing || connectionError }">
          ● {{ left ? 'saiu da sala' : connected ? 'conexão segura' : setupMissing ? 'configure o Supabase' : connectionError || 'conectando...' }}
        </span>
      </header>

      <div class="hero">
        <div class="mark">▶</div>
        <h2>Jogue com seus amigos</h2>
        <p>Você está na sala <strong>{{ currentRoom }}</strong>. Compartilhe sua tela quando quiser.</p>
      </div>

      <div v-if="setupMissing" class="setup-warning">
        <strong>Falta configurar a conexão.</strong>
        <span>Adicione <code>NUXT_PUBLIC_SUPABASE_URL</code> e <code>NUXT_PUBLIC_SUPABASE_ANON_KEY</code> nas variáveis da Vercel e faça um novo deploy.</span>
      </div>

      <div v-if="left" class="left-state">
        <div class="screen-icon">◖</div>
        <p>Você saiu da sala <strong>{{ currentRoom }}</strong></p>
        <button class="primary" @click="rejoinRoom">Entrar na sala</button>
      </div>

      <section v-else class="room">
        <div class="room-head">
          <h3>{{ currentRoom }}</h3>
          <span>{{ members.length }} participante{{ members.length === 1 ? '' : 's' }}</span>
        </div>

        <div class="room-code">
          <span>Convite da sala: <strong>{{ room }}</strong></span>
          <button class="copy" @click="copyInvite">Copiar convite</button>
        </div>

        <div class="screen">
          <video v-show="sharing" ref="previewVideo" autoplay muted playsinline />

          <div v-if="focusedPeer && remoteStreams.has(focusedPeer)" class="focused-wrap" :data-peer="focusedPeer">
            <video autoplay playsinline class="focused-video" />
            <span class="focused-label">{{ members.find(m => m.id === focusedPeer)?.animal || 'Desconhecido' }}</span>
            <button class="fs-btn" @click="toggleFullscreen(($event.target as HTMLElement).parentElement!)">⛶</button>
          </div>

          <div v-if="remoteStreams.size > 1" class="thumb-strip">
            <div
              v-for="[peerId] in remoteStreams"
              :key="peerId"
              class="thumb-tile"
              :class="{ active: focusedPeer === peerId }"
              :data-peer="peerId"
              @click="focusPeer(peerId)"
            >
              <video autoplay playsinline class="thumb-video" />
              <span class="thumb-label">{{ members.find(m => m.id === peerId)?.animal || '?' }}</span>
            </div>
          </div>

          <div v-if="remoteStreams.size === 1 && !focusedPeer" class="remote-grid">
            <div v-for="[peerId] in remoteStreams" :key="peerId" class="remote-tile" :data-peer="peerId">
              <video autoplay playsinline class="remote-video" />
              <span class="remote-label">{{ members.find(m => m.id === peerId)?.animal || 'Desconhecido' }}</span>
              <button class="fs-btn" @click.stop="toggleFullscreen(($event.target as HTMLElement).closest('.remote-tile')!)">⛶</button>
            </div>
          </div>

          <div v-if="!sharing && remoteStreams.size === 0" class="screen-content">
            <div class="screen-icon">▣</div>
            <p>Ninguém está transmitindo agora</p>
            <button class="primary" @click="startSharing">Transmitir minha tela</button>
          </div>
          <button v-if="sharing" class="stop" @click="stopSharing">Parar transmissão</button>
        </div>

        <div class="controls">
          <button class="control-btn" :class="{ active: sharing }" @click="sharing ? stopSharing() : startSharing()">
            {{ sharing ? '⏹ Tela' : '🖥 Tela' }}
          </button>
          <button class="control-btn leave" @click="leaveRoom">
            📞 Sair
          </button>
        </div>

        <div class="participants">
          <span v-for="member in members" :key="member.id" class="participant">
            <span class="avatar mini">{{ member.animal[0] }}</span>{{ member.animal }}
          </span>
        </div>
      </section>

      <p class="hint">Cada pessoa recebe um animal aleatório ao entrar. Troque de sala pelo menu lateral.</p>
    </section>
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

.left-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 0; }
.left-state .screen-icon { font-size: 48px; opacity: 0.4; }
.left-state p { color: var(--muted); font-size: 14px; }
.left-state .primary { margin-top: 8px; }

.remote-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; width: 100%; padding: 12px; }
.remote-tile { position: relative; background: #000; border-radius: 10px; overflow: hidden; aspect-ratio: 16/9; cursor: pointer; }
.remote-tile:hover { outline: 2px solid var(--purple); }
.remote-video { width: 100%; height: 100%; object-fit: contain; }
.remote-label { position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,0.7); padding: 3px 10px; border-radius: 5px; font-size: 12px; color: #fff; }

.focused-wrap { position: relative; width: 100%; height: 100%; background: #000; }
.focused-video { width: 100%; height: 100%; object-fit: contain; }
.focused-label { position: absolute; bottom: 12px; left: 12px; background: rgba(0,0,0,0.7); padding: 4px 12px; border-radius: 6px; font-size: 13px; color: #fff; }

.fs-btn { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border: 0; border-radius: 6px; background: rgba(0,0,0,0.6); color: #fff; font-size: 16px; cursor: pointer; display: grid; place-items: center; opacity: 0; transition: opacity 0.15s; z-index: 1; }
.focused-wrap:hover .fs-btn, .remote-tile:hover .fs-btn { opacity: 1; }
.fs-btn:hover { background: var(--purple); }

.thumb-strip { display: flex; gap: 8px; padding: 8px 12px; width: 100%; overflow-x: auto; }
.thumb-tile { position: relative; flex: 0 0 160px; background: #000; border-radius: 8px; overflow: hidden; aspect-ratio: 16/9; cursor: pointer; border: 2px solid transparent; transition: border-color 0.15s; }
.thumb-tile:hover, .thumb-tile.active { border-color: var(--purple); }
.thumb-video { width: 100%; height: 100%; object-fit: contain; }
.thumb-label { position: absolute; bottom: 4px; left: 4px; background: rgba(0,0,0,0.7); padding: 2px 6px; border-radius: 4px; font-size: 10px; color: #fff; }

.controls { display: flex; gap: 8px; justify-content: center; padding: 12px 0; }
.control-btn { padding: 8px 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--card2); color: var(--text); font-size: 13px; cursor: pointer; transition: all 0.15s; }
.control-btn:hover { background: var(--purple); border-color: var(--purple); }
.control-btn.active { background: var(--green); border-color: var(--green); color: #000; }
.control-btn.leave { background: transparent; border-color: #ef4444; color: #ef4444; }
.control-btn.leave:hover { background: #ef4444; color: #fff; }
</style>
