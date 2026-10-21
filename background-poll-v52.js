/* Each background job settles before its next timer begins. Foreground writes
   and their verification reads use the original application functions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FZBackgroundPoll = api.createScheduler(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function createScheduler(clock) {
    clock = clock || globalThis;
    const jobs = new Map();
    function stop(name) {
      const job = jobs.get(name);
      if (!job) return;
      job.stopped = true;
      clock.clearTimeout(job.timer);
      jobs.delete(name);
    }
    function schedule(name, callback, interval, options) {
      stop(name);
      options = options || {};
      const delay = Math.max(1, Number(interval) || 1);
      const job = { name, stopped: false, running: false, timer: null };
      jobs.set(name, job);
      async function tick() {
        if (job.stopped) return;
        try {
          if (!options.shouldRun || options.shouldRun()) {
            job.running = true;
            await callback();
          }
        } catch (_) {
          /* Application callbacks keep their existing failure handling. A failed
             background read must not stop future refreshes or reject globally. */
        } finally {
          job.running = false;
          if (!job.stopped) job.timer = clock.setTimeout(tick, delay);
        }
      }
      job.timer = clock.setTimeout(tick, delay);
      return () => { if (jobs.get(name) === job) stop(name); };
    }
    return {
      schedule,
      stop,
      stopAll: () => Array.from(jobs.keys()).forEach(stop),
      running: () => Array.from(jobs.values()).filter(job => job.running).map(job => job.name)
    };
  }
  return { createScheduler };
});
