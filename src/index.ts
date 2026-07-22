/**
 * Runtime entry point (`runs.main` in action.yml points at the bundle built
 * from this file). All logic lives in `./main`, which stays side-effect free so
 * the tests can import and drive `run()`.
 */
import { run } from './main'

run()
