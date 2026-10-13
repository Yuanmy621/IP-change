const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page, request }) => {
  await request.post('/api/location/reset', { data: {} });
  // Keep regression checks independent of public tile/geocoding availability.
  await page.route('https://webst02.is.autonavi.com/**', route => route.abort());
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
});

test('Mac 浏览器通过 HTTP 控制端搜索、应用与恢复', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('#runtimeMode')).toHaveText('界面预览');
  await expect(page.locator('#latitude')).toHaveValue('');
  await page.locator('#searchQuery').fill('23.1291,113.2644');
  await page.locator('#searchButton').click();
  await page.locator('#apply').click();
  await expect(page.locator('#reset')).toBeEnabled();
  const applied = await (await request.post('/api/preview/state', { data: {} })).json();
  expect(applied.session.latitude).toBe(23.1291);
  await page.locator('#reset').click();
  await expect(page.locator('#reset')).toBeDisabled();
});

test('当前位置失败保持空坐标，搜索坐标后可应用并恢复定位', async ({ page, request }) => {
  await page.goto('/?mode=phone&location=error&map=error');
  await expect(page.locator('#targetName')).toHaveText('尚未获取当前位置');
  await expect(page.locator('#latitude')).toHaveValue('');
  await expect(page.locator('#apply')).toBeDisabled();
  await expect(page.locator('#mapNotice')).toBeVisible();
  await expect(page.locator('#retryMap')).toBeVisible();
  await page.locator('#searchQuery').fill('39.9042, 116.4074');
  await page.locator('#searchButton').click();
  await expect(page.locator('#latitude')).toHaveValue('39.904200');
  await expect(page.locator('#longitude')).toHaveValue('116.407400');
  await page.locator('#apply').click();
  await expect(page.locator('#reset')).toBeEnabled();
  const applied = await (await request.post('/api/preview/state', { data: {} })).json();
  expect(applied.session.latitude).toBe(39.9042);
  expect(applied.session.longitude).toBe(116.4074);
  await page.locator('#reset').click();
  await expect(page.locator('#reset')).toBeDisabled();
  expect((await (await request.post('/api/preview/state', { data: {} })).json()).session).toBeNull();
});

test('迟到的当前位置不会覆盖用户手动选择', async ({ page }) => {
  let complete;
  const release = new Promise(resolve => { complete = resolve; });
  await page.route('**/api/location/current', async route => {
    await release;
    await route.fulfill({ json: { latitude: 39.9042, longitude: 116.4074, accuracy: 12, source: 'preview' } });
  });
  await page.goto('/?mode=phone&location=slow');
  await expect(page.locator('#targetName')).toHaveText('正在获取当前位置…');
  await page.locator('#latitude').fill('23.1291');
  await page.locator('#longitude').fill('113.2644');
  complete();
  await expect(page.locator('#currentLocation')).toBeEnabled();
  await expect(page.locator('#latitude')).toHaveValue('23.1291');
  await expect(page.locator('#longitude')).toHaveValue('113.2644');
});

test('地图源切换和主题切换保留目标，收藏覆盖重载', async ({ page }) => {
  await page.goto('/?mode=phone&location=error');
  await expect(page.locator('#targetName')).toHaveText('尚未获取当前位置');
  await page.locator('#searchQuery').fill('30.5728, 104.0668');
  await page.locator('#searchButton').click();
  await page.locator('#savePlace').click();
  await expect(page.locator('#favoritesCount')).toHaveText('1');
  await page.getByRole('button', { name: '设备与设置', exact: true }).filter({ visible: true }).last().click();
  await page.locator('#mapProvider').selectOption('osm');
  await expect(page.locator('#latitude')).toHaveValue('30.572800');
  await page.locator('#mapProvider').selectOption('amap');
  await expect(page.locator('#longitude')).toHaveValue('104.066800');
  await page.locator('input[name="theme"][value="light"]').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('#favoritesCount')).toHaveText('1');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('存在模拟会话时更新安装被阻止，恢复后展示系统安装入口', async ({ page, request }) => {
  await page.goto('/?mode=phone&location=error');
  await page.locator('#searchQuery').fill('31.2304,121.4737');
  await page.locator('#searchButton').click();
  await page.locator('#apply').click();
  await expect(page.locator('#reset')).toBeEnabled();
  await page.getByRole('button', { name: '设备与设置', exact: true }).filter({ visible: true }).last().click();
  await page.locator('#updateCheck').click();
  await expect(page.locator('#updateDownload')).toBeVisible();
  await page.locator('#updateDownload').click();
  await expect(page.locator('#updateInstall')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('#updateInstall')).toBeDisabled();
  const rejected = await (await request.post('/api/updates/install', { data: {} })).json();
  expect(rejected.error).toContain('请先恢复真实定位');
  await request.post('/api/location/reset', { data: {} });
  await expect(page.locator('#updateInstall')).toBeEnabled();
  await page.locator('#updateInstall').click();
  await expect(page.locator('#updateMessage')).toContainText('系统安装确认');
});
