'use client';

import type { Entity } from 'koota';
import { useQuery } from 'koota/react';
import { useCallback } from 'react';
import { Character } from '../character/Character';
import type { CharacterFrame } from '../character/motion';
import { Anim, Held, IsLocal, IsPlayer, Look, NetId, Transform, Vitals } from '../ecs/traits';
import { useHud } from '../hud/hud-store';
import { useRuntime } from '../runtime';

/** React re-renders only when players join or leave (or a new match starts); movement is written to refs. */
export function Players() {
  const players = useQuery(IsPlayer);
  useHud((s) => s.setupRevision); // redraw when the match setup changes
  return (
    <>
      {players.map((entity) => (
        <PlayerCharacter key={entity} entity={entity} />
      ))}
    </>
  );
}

const labelFor = (id: string, isLocal: boolean, bot: boolean) => (isLocal ? 'You' : bot ? `Bot ${id.replace(/^bot-/, '')}` : 'Player');

function PlayerCharacter({ entity }: { entity: Entity }) {
  const runtime = useRuntime();
  const { config, appearance } = runtime;
  const isLocal = entity.has(IsLocal);
  const { look, bot } = entity.get(Look) ?? { look: 0, bot: false };
  const id = entity.get(NetId)?.id ?? '';

  const sample = useCallback(
    (out: CharacterFrame) => {
      // In first person the player is the camera: their own body would fill the view.
      if (isLocal && runtime.view === 'first-person') return false;
      const transform = entity.get(Transform);
      const vitals = entity.get(Vitals);
      const anim = entity.get(Anim);
      if (!transform || !vitals || !anim) return false;
      out.x = transform.x;
      out.y = transform.y;
      out.z = transform.z;
      out.yaw = transform.yaw;
      out.status = vitals.status;
      out.protected = vitals.protected;
      out.health = vitals.health;
      out.throwAt = anim.throwAt;
      out.hitAt = anim.hitAt;
      out.weapon = entity.get(Held)?.weapon;
      return true;
    },
    [entity, isLocal, runtime],
  );

  return (
    <Character
      appearance={appearance}
      look={look}
      bot={bot}
      isLocal={isLocal}
      label={labelFor(id, isLocal, bot)}
      radius={config.playerRadius}
      height={config.playerHeight}
      maxHealth={config.startingHealth}
      runSpeed={config.playerSpeed}
      sample={sample}
    />
  );
}
