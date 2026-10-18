// Server-side entry point for the SHARED validation rules.
//
// The real implementation lives in public/js/validation.js because the browser
// can only load scripts from under public/, while Node can require() from
// anywhere. Rather than maintain two copies of every regex - which is how
// client and server validation always drift apart in the end - there is exactly
// one file, written with a UMD wrapper so it works in both environments.
//
// This shim exists purely so route files can write the natural thing:
//
//     const V = require('../utils/validate');
//
// instead of reaching across into the public folder. Add nothing here; put new
// rules in public/js/validation.js so both sides get them.
module.exports = require('../public/js/validation.js');
