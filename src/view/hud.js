// DOM HUD: hp bar, weapon chip, counters, kill feed, hit marker, overlays.
import { CONFIG } from '../logic/config.js';
import { distXZ } from '../logic/vec3.js';

export function createHud() {
  const $ = (id) => document.getElementById(id);

  const chips = [
    { name: 'ОВОЩЕМЁТ', sub: `ЛКМ — выстрел · ${CONFIG.bin.hits} прилипаний = бак!` },
    { name: 'ХЛАМОМЁТ', sub: `дробовик: ${CONFIG.junk.pellets} ствола · вдвое липче` },
  ].map((w, i) => {
    const c = document.createElement('div');
    c.className = 'chip';
    c.innerHTML = `<b><span class="k">${i + 1}</span> ${w.name}</b><span class="sub">${w.sub}</span>`;
    $('veggies').appendChild(c);
    return c;
  });

  const feed = (text) => {
    const line = document.createElement('div');
    line.textContent = text;
    const f = $('feed');
    f.prepend(line);
    while (f.children.length > 5) f.lastChild.remove();
    setTimeout(() => line.remove(), 6000);
  };

  let flashT = 0;
  let hitT = 0;

  const hud = {
    update(state, input) {
      const p = state.player;
      const hpPct = Math.max(0, p.hp / CONFIG.player.maxHp);
      $('hpfill').style.width = `${hpPct * 100}%`;
      $('hpfill').style.background = hpPct > 0.5 ? '#4fd35a' : hpPct > 0.25 ? '#e8c53a' : '#e23b2e';

      const aliveBots = state.bots.filter((b) => b.alive).length;
      const aliveHumans = state.humans.filter((h) => h.alive && h !== p).length;
      $('alive').textContent = `Живых: ${aliveBots + aliveHumans + (p.alive ? 1 : 0)}`;
      $('kills').textContent = `Фраги: ${state.stats.kills} · Жизни: ${'♥'.repeat(Math.max(0, p.lives))}`;
      const zc = CONFIG.zone;
      const shrinking = state.time > zc.shrinkDelay;
      $('zoneline').textContent = shrinking
        ? `Зона: ${state.zone.radius.toFixed(0)} м · урон ${state.zone.dps.toFixed(0)}/с`
        : `Зона сжимается через ${(zc.shrinkDelay - state.time).toFixed(0)} с`;

      chips.forEach((c, i) => {
        c.classList.toggle('sel', (p.slot || 0) === i);
        c.classList.toggle('missing', !!(p.guns && !p.guns[i]));   // not looted yet
      });

      const outside =
        state.playerEngaged && p.alive && !p.binned && !p.onBalcony &&
        Math.hypot(p.pos.x - state.zone.cx, p.pos.z - state.zone.cz) > state.zone.radius;
      $('zoneflash').style.opacity = outside ? 1 : 0;

      // veggie coating + kick prompt
      $('hptext').textContent = p.vegCount > 0
        ? `HP ${Math.ceil(Math.max(0, p.hp))} / ${CONFIG.player.maxHp} · овощей на вас: ${p.vegCount}/${CONFIG.bin.hits}`
        : `HP ${Math.ceil(Math.max(0, p.hp))} / ${CONFIG.player.maxHp}`;
      let nearBin = false;
      if (p.alive && !p.binned && !p.onBalcony && !p.zombie) {
        for (const b of state.humans.concat(state.bots)) {
          if (b.binned && distXZ(p.pos, b.pos) < CONFIG.bin.kickRange) { nearBin = true; break; }
        }
      }
      const kh = $('kickhint');
      const canE = p.alive && !p.zombie && !p.binned && !p.onBalcony;
      const nearButton =
        canE && state.button &&
        distXZ(p.pos, state.button.pos) < CONFIG.zombies.pressRange;
      const nearPop =
        canE && (state.lootPops || []).some(
          (lp) => distXZ(p.pos, lp.pos) < CONFIG.loot.openRange);
      const nearCrate =
        canE && (state.crates || []).some(
          (c) => !c.opened && distXZ(p.pos, c.pos) < CONFIG.loot.openRange);
      kh.textContent = nearPop ? 'E — ВЗЯТЬ ОРУЖИЕ'
        : nearButton ? 'E — ВЫПУСТИТЬ ЗОМБИ!'
        : nearCrate ? 'E — ОТКРЫТЬ ЯЩИК'
        : 'E — ПНУТЬ БАК!';
      kh.style.opacity = (nearBin || nearButton || nearPop || nearCrate) ? 1 : 0;
      $('scope').style.opacity = p.mounted != null ? 1 : 0;

      if (flashT > 0) {
        flashT -= 0.016;
        if (flashT <= 0) $('dmgflash').style.opacity = 0;
      }
      if (hitT > 0) {
        hitT -= 0.016;
        if (hitT <= 0) $('hitmark').style.opacity = 0;
      }

      const msg = $('msg');
      if (p.zombie && p.alive) {
        msg.innerHTML = '<div class="big">ВЫ — ЗОМБИ</div>' +
          '<div class="small">ЛКМ / E — укусить · оружия нет · смерть излечивает</div>';
      } else if ((p.binFlyT || 0) > 0) {
        msg.innerHTML = '<div class="big">ВАС ПНУЛИ!</div><div class="small">летите в баке…</div>';
      } else if (state.phase === 'won') {
        msg.innerHTML = '<div class="big">ПОБЕДА!</div><div class="small">Все овощи съедены. R — заново</div>';
      } else if (state.phase === 'lost') {
        msg.innerHTML = '<div class="big">ВЫ ВЫБЫЛИ</div><div class="small">R — заново</div>';
      } else if (p.onBalcony) {
        msg.innerHTML = p.mounted != null
          ? '<div class="big">СНАЙПЕРКА</div><div class="small">ЛКМ — выстрел слизью · E — отойти от пушки</div>'
          : '<div class="big">БАЛКОН</div><div class="small">редроп через ' +
            Math.max(0, p.balconyTimer).toFixed(0) +
            ' с · подойдите к пушке — E, чтобы взять прицел</div>';
      } else if (!input.everLocked) {
        msg.innerHTML = '<div class="big">ОВОЩНАЯ БИТВА</div>' +
          '<div class="small">Кликните, чтобы играть — последний уцелевший побеждает</div>';
      } else if (!input.locked) {
        msg.innerHTML = '<div class="big">ПАУЗА</div><div class="small">Кликните, чтобы продолжить</div>';
      } else if (p.slimedTimer > 0) {
        msg.innerHTML = '<div class="big">ВАС ПРИПЕЧАТАЛО!</div>' +
          `<div class="small">слизь отлипнет через ${p.slimedTimer.toFixed(1)} с — стрелять можно</div>`;
      } else if (p.binned) {
        msg.innerHTML = '<div class="big">ВЫ — БАК С ОВОЩАМИ</div>' +
          `<div class="small">вылезете через ${Math.max(0, p.binTimer).toFixed(1)} с — молитесь, чтобы никто не пнул</div>`;
      } else {
        msg.innerHTML = '';
      }
    },

    onEvent(e) {
      if (e.type === 'hit' && e.target === 'player') {
        $('dmgflash').style.opacity = 1;
        flashT = 0.35;
      } else if (e.type === 'hit' && e.byPlayer) {
        $('hitmark').style.opacity = 1;
        hitT = 0.5;
      } else if (e.type === 'binned') {
        const what = e.kind === 'toast' ? 'ТОСТЕРОМ' : 'БАКОМ';
        if (e.target === 'player') {
          $('dmgflash').style.opacity = 1;
          flashT = 0.5;
          feed(`Вы стали ${what} — ждите или вас пнут!`);
        } else {
          feed(`${e.name} стал ${what.toLowerCase()}${e.byPlayer ? ' (ваш заслуженный)' : ''}`);
        }
      } else if (e.type === 'binKicked') {
        const what = e.kind === 'toast' ? 'тостер улетел, тосты на всех!' : 'бак улетел';
        feed(`${e.name} выбыл — ${what}${e.byPlayer ? ' (ваш фраг)' : ''}`);
      } else if (e.type === 'crateOpen') {
        feed(e.byPlayer
          ? 'Ящик открыт — забирайте пушку!'
          : `${e.name} открыл ящик`);
      } else if (e.type === 'loot') {
        const gun = e.slot === 1 ? 'ХЛАМОМЁТ' : 'ОВОЩЕМЁТ';
        feed(e.byPlayer
          ? (e.healed > 0 ? `Ящик: та же пушка — +${e.healed} HP` : `Вы нашли ${gun}!`)
          : `${e.name} нашёл ${gun.toLowerCase()}`);
      } else if (e.type === 'heal') {
        if (e.target === 'player') feed(`тост +${e.amount} HP`);
      } else if (e.type === 'toBalcony') {
        feed(e.target === 'player'
          ? `Вы на балконе — жизней осталось: ${e.lives}`
          : `${e.name} улетел на балкон (жизней: ${e.lives})`);
      } else if (e.type === 'redeploy') {
        feed(e.target === 'player' ? 'Вы снова в бою!' : `${e.name} вернулся в бой`);
      } else if (e.type === 'slimed') {
        if (e.target === 'player') {
          $('dmgflash').style.opacity = 1;
          flashT = 0.4;
        }
      } else if (e.type === 'revived') {
        feed(e.target === 'player'
          ? 'Вы вылезли из бака (половина HP)'
          : `${e.name} вылез из бака (половина HP)`);
      } else if (e.type === 'button') {
        feed(e.byPlayer ? 'Вы ВЫПУСТИЛИ ЗОМБИ!' : `${e.name} выпустил зомби!`);
      } else if (e.type === 'infected') {
        feed(e.target === 'player'
          ? 'ВАС УКУСИЛИ — вы теперь зомби!'
          : `${e.name} стал зомби!`);
      } else if (e.type === 'kill') {
        feed(e.attacker === 'zone'
          ? `${e.name} съеден зоной`
          : `${e.name} выбыл${e.attacker === 'player' ? ' (ваш фраг)' : ''}`);
      }
    },
  };
  return hud;
}
