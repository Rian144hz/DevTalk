/**
 * The files in the data folder that "delete my local data" removes: the study database, the saved keys, the community session
 * and its caches, and the daily challenge's settings. Whole names only; anything else in the folder is left alone.
 */
export const LOCAL_DATA_FILE =
  /^(devtalk\.sqlite(-wal|-shm)?|api-key.*\.bin|social-session\.bin|fake-social\.json|practice-sync\.json|daily\.json)$/;
