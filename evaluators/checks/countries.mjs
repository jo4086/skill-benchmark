import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { projectRoot, run, userDirectory } from '../../bootstrap/environment/common.mjs';
import { temporaryWorkDirectory } from '../../runner/storage/storage.mjs';
import { check, command, serve, technicalStack } from './frontend-common.mjs';

export const countriesEvaluatorVersion = 1;
export const countriesSourceSha256 = '9e7ba43d5d9894db33a0bc16ed5a49aebaeeaf0da8c3fffdaa6eb9f986b8583e';
const archive = path.join(projectRoot, 'tasks', 'FE-01', 'source', 'rest-countries-api-with-color-theme-switcher-master.zip');
const dataEntry = 'rest-countries-api-with-color-theme-switcher-master/data.json';
const browserIds = ['FE01-F01', 'FE01-F02', 'FE01-F03', 'FE01-F04', 'FE01-F05',
  'FE01-F06', 'FE01-F07', 'FE01-F08', 'FE01-A01'];

async function loadCountries() {
  const actual = createHash('sha256').update(await fs.readFile(archive)).digest('hex');
  if (actual !== countriesSourceSha256) throw new Error('REST Countries source ZIP changed');
  const data = await run('unzip', ['-p', archive, dataEntry]);
  const countries = JSON.parse(data);
  if (!Array.isArray(countries) || countries.length !== 250) throw new Error('Invalid REST Countries reference data');
  return { data, countries };
}

export async function restoreCountriesReference(workDir) {
  const { data, countries } = await loadCountries();
  const referenceDir = path.join(workDir, 'reference');
  await fs.mkdir(referenceDir, { recursive: true });
  await fs.writeFile(path.join(referenceDir, 'data.json'), data);
  return countries;
}

async function visibleNames(page, countries) {
  const present = await Promise.all(countries.map(async ({ name }) =>
    await page.locator('main').getByRole('heading', { name, exact: true }).first().isVisible().catch(() => false) ? name : null));
  return present.filter(Boolean).sort();
}

function expectedNames(countries, { query = '', region = '' } = {}) {
  return countries.filter((country) => (!region || country.region === region)
    && country.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map((country) => country.name).sort();
}

async function searchBox(page) {
  const box = page.getByRole('searchbox').first();
  if (await box.count()) return box;
  return page.getByPlaceholder(/search/i).first();
}

async function selectRegion(page, region) {
  const select = page.getByRole('combobox').first();
  if (await select.count()) { await select.selectOption(region ? { label: region } : { value: '' }); return; }
  await page.getByRole('button', { name: /filter by region|all regions|selected/i }).first().click();
  const option = page.getByRole('option', { name: region || /all regions/i, exact: Boolean(region) });
  if (await option.count()) await option.first().click();
  else await page.getByRole('button', { name: region || /all regions/i, exact: Boolean(region) }).last().click();
}

async function clickCountry(page, name) {
  await page.locator('main').getByText(name, { exact: true }).first().click();
}

async function detailName(page) {
  return page.locator('main h1').first().textContent().then((value) => value?.trim());
}

export async function countriesBrowserChecks(workDir, countries) {
  const server = await serve(path.join(workDir, 'dist'));
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/snap/bin/chromium', args: ['--no-sandbox'] });
    async function fresh() {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.setDefaultTimeout(5000);
      await page.goto(server.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.locator('main').getByText(countries[0].name, { exact: true }).first().waitFor();
      return page;
    }
    async function inspect(id, action) {
      let page;
      try {
        page = await fresh();
        const evidence = await action(page);
        return check(id, evidence.pass ? 'pass' : 'fail', evidence);
      } catch (error) { return check(id, 'fail', { reason: error.message }); }
      finally { await page?.close(); }
    }
    const all = expectedNames(countries);
    const germany = countries.find((item) => item.name === 'Germany');
    const france = countries.find((item) => item.alpha3Code === 'FRA');
    const antarctica = countries.find((item) => item.name === 'Antarctica');
    const aland = countries.find((item) => item.name === 'Åland Islands');
    if (!germany || !france || !antarctica || !aland) throw new Error('Reference countries for checks are missing');
    return [
      await inspect('FE01-F01', async (page) => {
        const observed = await visibleNames(page, countries);
        const duplicateNames = (await Promise.all(countries.map(async ({ name }) =>
          await page.locator('main').getByRole('heading', { name, exact: true }).count() > 1 ? name : null))).filter(Boolean);
        return { pass: JSON.stringify(observed) === JSON.stringify(all) && duplicateNames.length === 0, expectedCount: all.length,
          observedCount: observed.length, missing: all.filter((name) => !observed.includes(name)).slice(0, 20),
          duplicateNames: duplicateNames.slice(0, 20) };
      }),
      await inspect('FE01-F02', async (page) => {
        await (await searchBox(page)).fill('Germany');
        const observed = await visibleNames(page, countries);
        return { pass: JSON.stringify(observed) === JSON.stringify(['Germany']), query: 'Germany', observed };
      }),
      await inspect('FE01-F03', async (page) => {
        await selectRegion(page, 'Asia');
        const asia = await visibleNames(page, countries);
        await selectRegion(page, 'Europe');
        const europe = await visibleNames(page, countries);
        return { pass: JSON.stringify(asia) === JSON.stringify(expectedNames(countries, { region: 'Asia' }))
          && JSON.stringify(europe) === JSON.stringify(expectedNames(countries, { region: 'Europe' })),
        asiaCount: asia.length, europeCount: europe.length };
      }),
      await inspect('FE01-F04', async (page) => {
        await clickCountry(page, germany.name);
        const name = await detailName(page);
        const text = await page.locator('main').innerText();
        const back = page.getByRole('link', { name: /back/i }).first();
        const detailPass = name === germany.name && [germany.capital, germany.nativeName,
          germany.subregion, germany.population.toLocaleString('en-US')].every((value) => text.includes(value));
        await back.click();
        const returned = await page.locator('main').getByText(germany.name, { exact: true }).first().isVisible();
        return { pass: detailPass && returned, name, returned, detailPass };
      }),
      await inspect('FE01-F05', async (page) => {
        await clickCountry(page, germany.name);
        await page.getByRole('link', { name: france.name, exact: true }).first().click();
        const name = await detailName(page);
        return { pass: name === france.name && germany.borders.includes(france.alpha3Code),
          source: germany.name, borderCode: france.alpha3Code, destination: name };
      }),
      await inspect('FE01-F06', async (page) => {
        const box = await searchBox(page);
        await box.fill('Germany');
        await selectRegion(page, 'Asia');
        const none = await visibleNames(page, countries);
        await selectRegion(page, 'Europe');
        const germanyOnly = await visibleNames(page, countries);
        await box.fill('');
        const europe = await visibleNames(page, countries);
        return { pass: none.length === 0 && JSON.stringify(germanyOnly) === JSON.stringify(['Germany'])
          && JSON.stringify(europe) === JSON.stringify(expectedNames(countries, { region: 'Europe' })),
        noneCount: none.length, germanyOnly, europeCount: europe.length };
      }),
      await inspect('FE01-F07', async (page) => {
        const box = await searchBox(page);
        await box.fill('zzzz-no-country');
        const none = await visibleNames(page, countries);
        await box.fill('');
        const restored = await visibleNames(page, countries);
        return { pass: none.length === 0 && JSON.stringify(restored) === JSON.stringify(all),
          emptyCount: none.length, restoredCount: restored.length };
      }),
      await inspect('FE01-F08', async (page) => {
        await clickCountry(page, antarctica.name);
        const emptyCapital = await page.locator('main').innerText();
        await page.getByRole('link', { name: /back/i }).first().click();
        await clickCountry(page, aland.name);
        const noBorders = await page.locator('main').innerText();
        return { pass: await detailName(page) === aland.name
          && !/\b(?:undefined|null|NaN)\b/i.test(`${emptyCapital}\n${noBorders}`),
        countries: [antarctica.name, aland.name] };
      }),
      await inspect('FE01-A01', async (page) => {
        const box = await searchBox(page);
        await box.focus();
        await page.keyboard.type('Japan');
        const searchWorked = await page.locator('main').getByText('Japan', { exact: true }).first().isVisible();
        const japanText = page.locator('main').getByText('Japan', { exact: true }).first();
        const japanLink = japanText.locator('xpath=ancestor::a[1]');
        await japanLink.focus();
        await page.keyboard.press('Enter');
        await page.locator('main h1').filter({ hasText: 'Japan' }).waitFor();
        const detailWorked = await detailName(page) === 'Japan';
        const back = page.getByRole('link', { name: /back/i }).first();
        await back.focus();
        await page.keyboard.press('Enter');
        const backWorked = await page.locator('main').getByText('Japan', { exact: true }).first().isVisible();
        await box.fill('');
        await clickCountry(page, germany.name);
        const border = page.getByRole('link', { name: france.name, exact: true }).first();
        await border.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('heading', { name: france.name, exact: true }).first().waitFor();
        const borderWorked = await detailName(page) === france.name;
        const returnLink = page.getByRole('link', { name: /back/i }).first();
        await returnLink.focus();
        await page.keyboard.press('Enter');
        await page.locator('main').getByRole('heading', { name: germany.name, exact: true }).first().waitFor();
        const select = page.getByRole('combobox').first();
        let selectedRegion;
        if (await select.count()) {
          await select.focus();
          await page.keyboard.press('End');
          await page.keyboard.press('Enter');
          selectedRegion = await select.inputValue();
        } else {
          const trigger = page.getByRole('button', { name: /filter by region|all regions|selected/i }).first();
          await trigger.focus();
          await page.keyboard.press('Enter');
          const option = page.getByRole('button', { name: 'Asia', exact: true }).last();
          await option.focus();
          await page.keyboard.press('Enter');
          selectedRegion = 'Asia';
        }
        const regionWorked = Boolean(selectedRegion)
          && JSON.stringify(await visibleNames(page, countries)) === JSON.stringify(expectedNames(countries, { region: selectedRegion }));
        return { pass: searchWorked && detailWorked && backWorked && borderWorked && regionWorked,
          searchWorked, detailWorked, backWorked, borderWorked, regionWorked, selectedRegion };
      }),
    ];
  } finally { await browser?.close(); await server.close(); }
}

export async function evaluateCountriesRun(runRecord) {
  const checks = [];
  if (!runRecord.workDir || !path.isAbsolute(runRecord.workDir)) {
    return { version: countriesEvaluatorVersion, checks: ['FE01-T01', 'FE01-T02', ...browserIds]
      .map((id) => check(id, 'error', { reason: 'missing workDir' })) };
  }
  const home = await temporaryWorkDirectory('countries-evaluator');
  try {
    const countries = await restoreCountriesReference(runRecord.workDir);
    try { checks.push(await technicalStack(runRecord.workDir, 'FE01')); }
    catch (error) { checks.push(check('FE01-T01', 'error', { reason: error.message })); }
    const install = await command('pnpm', ['install', '--frozen-lockfile', '--store-dir', path.join(userDirectory('XDG_CACHE_HOME', '.cache'), 'pnpm-store')], runRecord.workDir, home, 180000);
    const build = install.exitCode === 0 && !install.timedOut
      ? await command('pnpm', ['build'], runRecord.workDir, home, 120000) : null;
    const buildPass = Boolean(build && build.exitCode === 0 && !build.timedOut);
    checks.push(check('FE01-T02', install.error || install.timedOut ? 'error' : buildPass ? 'pass' : 'fail', { install, build }));
    if (buildPass) {
      try { checks.push(...await countriesBrowserChecks(runRecord.workDir, countries)); }
      catch (error) { checks.push(...browserIds.map((id) => check(id, 'error', { reason: error.message }))); }
    } else checks.push(...browserIds.map((id) => check(id, 'not_evaluated', { reason: 'build unavailable' })));
    return { version: countriesEvaluatorVersion, checks };
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}
