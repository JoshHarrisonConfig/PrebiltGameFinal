export const STORAGE_KEYS = {
  USERNAME: 'prebilt_username',
  EMAIL: 'prebilt_email',
  USERS: 'prebilt_users',
  SPOT_PRIZE: 'prebilt_spotPrize',
  BARCODE_SEQUENCE: 'prebilt_barcodeSequence',
  LEADERBOARD: 'prebilt_leaderboard'
};

export const DEFAULT_SETTINGS = {
  spotPrizeInterval: 5,
  barcodeSequence: Array(10).fill('').map((_, i) => ({
    position: i + 1,
    code: '',
    description: ''
  }))
};