const fs = require('fs');
const http = require('http');

const filePath = 'test_data.csv';
const fileContent = fs.readFileSync(filePath);
const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';

const parts = [
  `--${boundary}`,
  'Content-Disposition: form-data; name="file"; filename="test_data.csv"',
  'Content-Type: text/csv',
  '',
  fileContent.toString(),
  `--${boundary}--`
];

const body = parts.join('\r\n');

const options = {
  hostname: 'localhost',
  port: 3333,
  path: '/api/upload',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.write(body);
req.end();
