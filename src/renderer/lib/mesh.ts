// Who connects to whom in a voice room. Everyone has a direct connection to everyone else (at most 5 each). In each
// pair the person with the smaller id makes the offer and the other waits for it, so both sides agree without talking.

export interface MeshPlan {
  /** New people with a larger id: offer to them. */
  offer: string[];
  /** New people with a smaller id: wait for their offer. */
  await: string[];
  /** People connected (or connecting) who are no longer live: say bye and close. */
  drop: string[];
}

/** What to do now, given who is live in the room (you may be in the list) and who you already have a connection to. */
export function meshPlan(myId: string, live: string[], peers: string[]): MeshPlan {
  const here = new Set(live);
  here.delete(myId);
  const have = new Set(peers);
  have.delete(myId);
  const fresh = [...here].filter((id) => !have.has(id)).sort();
  return {
    offer: fresh.filter((id) => myId < id),
    await: fresh.filter((id) => myId > id),
    drop: [...have].filter((id) => !here.has(id)).sort(),
  };
}
