
const path = require('path');
const driverPath = '/tmp/external-driver';
try {
    const driver = require(driverPath);
    console.log(driver.hello());
} catch (e) {
    console.error('Failed to load:', e);
}
