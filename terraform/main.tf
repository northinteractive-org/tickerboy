# Configure the AWS Provider
provider "aws" {
  region = "us-east-1"
}

# Terraform Backend Configuration (S3)
terraform {
  backend "s3" {
    bucket         = "northinteractive-org-tickerboy-tfstate"  # Replace with your S3 bucket name
    key            = "stock-data-table/terraform.tfstate"
    region         = "us-east-1"  
  }
}

# S3 Bucket Resource (If you haven't created the bucket yet)
resource "aws_s3_bucket" "terraform_state_bucket" {
  bucket = "northinteractive-org-tickerboy-tfstate"
}

# DynamoDB Table Resource for Stock Data
resource "aws_dynamodb_table" "tickerboy_stock_data" {
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
