/** A member's Vortex profile page. */
export const profileHref = (email: string) => `#/profile/${encodeURIComponent(email.toLowerCase())}`;
