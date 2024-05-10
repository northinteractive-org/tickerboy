import json
import boto3
import os
import requests
from datetime import datetime, timedelta



def lambda_handler(event, context):

    dynamodb = boto3.resource('dynamodb')
    ssm = boto3.client('ssm')
    
    table_name = os.environ['TABLE_NAME']
    parameter = ssm.get_parameter(Name='alphavantage_api', WithDecryption=True)
    alpha_vantage_api_key = parameter['Parameter']['Value']

    table = dynamodb.Table(table_name)

    # Scan the DynamoDB table to get all items
    response = table.scan()
    items = response['Items']
    while 'LastEvaluatedKey' in response:
        response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
        items.extend(response['Items'])

    # Calculate yesterday's date
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

    # Loop through each item and fetch data
    for item in items:
        symbol = item['Symbol']
        url = f'https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol={symbol}&apikey={alpha_vantage_api_key}'
        response = requests.get(url)
        data = response.json()

        if 'Time Series (Daily)' in data:
            daily_data = data['Time Series (Daily)']
            if yesterday in daily_data:
                item['LastOpen'] = daily_data[yesterday]['1. open']
                item['LastClose'] = daily_data[yesterday]['4. close']

                # Update the item in DynamoDB
                table.put_item(Item=item)
            else:
                print(f"No data for {symbol} on {yesterday}")
        else:
            print(f"Error fetching data for {symbol}: {data.get('Error Message', 'Unknown error')}")
