# Configure the AWS Provider
provider "aws" {
  region = "us-east-1"
}

# DynamoDB Table Resource
resource "aws_dynamodb_table" "stock_data" {
  name           = "stock_data"  
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "Symbol"

  attribute {
    name = "Symbol"
    type = "S"
  }

  global_secondary_index {
    name               = "SectorIndex"
    hash_key           = "Sector"
    projection_type    = "ALL"
  }

  tags = {
    Name        = "StockData"
    Environment = "production"
  }
}
