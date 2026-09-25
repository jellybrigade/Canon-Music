// Module scope so the For You picks hold across Home mounts and only reshuffle on refresh or relaunch.
let forYouSeed = Math.floor(Math.random() * 1_000_000);

export function getForYouSeed(): number {
  return forYouSeed;
}

export function nextForYouSeed(): number {
  forYouSeed += 1;
  return forYouSeed;
}
