import json
import boto3
import urllib3
import os
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
table_name = os.environ['TABLE_NAME']  

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
            symbol = values[0]

            # Check for empty Symbol
            if not symbol: 
                print(f"Skipping row with empty Symbol: {line}") 
                continue  # Skip this row and move to the next

            item = {
                'Symbol': symbol,
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
