declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    NU_DB?: D1Database;
    MA_DB?: D1Database;
  }
}
