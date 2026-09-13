/* Single source of truth for the option lists the client renders as
   pickers and the server validates incoming values against. Both
   App.jsx (bundled by Vite for the browser) and api/_util.js (run by
   Node on Vercel) import this same file directly — previously each side
   kept its own copy, and a topic added to one without the other would
   silently disappear server-side with no error surfaced. */

export const TOPICS = [
  'Anxiety', 'Low mood', 'Loneliness', 'Work stress', 'Grief',
  'Relationships', 'Family', 'Sleep', 'Burnout', 'Health worry',
  'Money', 'Identity', 'Studies', 'Parenting', 'Recovery',
];

export const LANGUAGES = ['English', 'Arabic', 'Hindi', 'Urdu', 'Spanish', 'French', 'Swahili', 'Tagalog'];

export const MODES = ['voice', 'video', 'text'];

export const ROLES = ['seeker', 'listener', 'both'];
