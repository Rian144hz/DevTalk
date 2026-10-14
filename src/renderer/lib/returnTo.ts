// Where the "Back" link of a legal document leads (joining, Settings, or People by default).
let target = { hash: '#/people', label: 'Back to People' };

export function setReturnTo(hash: string, label: string): void {
  target = { hash, label };
}

export function returnTo(): { hash: string; label: string } {
  return target;
}
