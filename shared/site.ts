export const XYVORA_NAME = 'Xyvora AI';
export const XYVORA_SITE = 'xyvora.net';
export const XYVORA_URL = `https://${XYVORA_SITE}`;
export const XYVORA_SLOGAN = 'Think big. Leap ahead.';
export const SITE_DESCRIPTION = 'Xyvora AI is a free AI workspace for quick answers, learning, writing, and working with files. Chat and use built-in tools without an account.';
export const ABOUT_PATH = '/about';
export const SCHOOLS_PATH = '/schools';
export const ABOUT_URL = `${XYVORA_URL}${ABOUT_PATH}`;

export const SITE_LINKS = [[ABOUT_PATH, 'About'], [SCHOOLS_PATH, 'For schools'], ['/developers', 'API'], ['/analytics', 'Analytics'], ['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/cookies', 'Cookies']] as const;

export const TEAM_NAME = 'Xyvora team';
export const TEAM_LINK_LABEL = 'Meet the Xyvora Team';
export const TEAM = [
  { name: 'Ethan Bennett', role: 'Founder and coder', initials: 'EB' },
  { name: 'Noberto Dominguez', role: 'Designer', initials: 'ND' },
  { name: 'Elijah Richardson', role: 'Unsure', initials: 'ER' },
] as const;
