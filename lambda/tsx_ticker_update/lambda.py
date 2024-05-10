import json
import boto3
import urllib3
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table_name = 'tickerboy_stock_data'  # Replace with your table name

def lambda_handler(event, context):
    http = urllib3.PoolManager()
    url = 'https://www.tsx.com/files/trading/interlisted-companies.txt'

    response = http.request('GET', url)

    if response.status == 200:
        data = response.data.decode('utf-8')
        lines = data.strip().split('\n')
        headers = lines[0].split('\t')
        tickers = []

        for line in lines[1:]:
            values = line.split('\t')
            item = {
                'Symbol': values[0],
                'LastOpen': None,
                'LastClose': None,
            }
            for i in range(1, len(headers)):
                item[headers[i]] = values[i]
            tickers.append(item)

        table = dynamodb.Table(table_name)
        with table.batch_writer() as batch:
            for ticker in tickers:
                batch.put_item(Item=ticker)

        print(f"Successfully updated {len(tickers)} tickers on {datetime.now()}")

    else:
        print(f"Error fetching data from {url}: Status Code {response.status}")
