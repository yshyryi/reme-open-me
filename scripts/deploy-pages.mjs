// Publish ./dist to the `gh-pages` branch of `origin` (GitHub Pages serves that branch).
// Usage: npm run deploy   (builds first). Uses your normal git credentials for `origin`.
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
const remote = execSync('git remote get-url origin').toString().trim();

writeFileSync('dist/.nojekyll', ''); // serve files as-is (no Jekyll processing)
rmSync('dist/.git', { recursive: true, force: true });
sh('git init -q -b gh-pages', 'dist');
sh('git add -A', 'dist');
sh('git -c user.name=yshyryi -c user.email=165659376+yshyryi@users.noreply.github.com commit -q -m "Deploy"', 'dist');
sh(`git push -f ${remote} gh-pages`, 'dist');
rmSync('dist/.git', { recursive: true, force: true });
console.log('Deployed → https://yshyryi.github.io/reme-open-me/');
