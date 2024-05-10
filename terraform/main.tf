# Configure the AWS Provider
provider "aws" {
  region = "us-east-1"
}

# Terraform Backend Configuration (S3)
terraform {
  backend "s3" {
    bucket = "northinteractive-org-tickerboy-tfstate"
    key    = "stock-data-table/terraform.tfstate"
    region = "us-east-1"
  }
}

# S3 Bucket Resource (If you haven't created the bucket yet)
resource "aws_s3_bucket" "terraform_state_bucket" {
  bucket = "northinteractive-org-tickerboy-tfstate"
}


# IAM Role for Lambda Function
resource "aws_iam_role" "lambda_role" {
  name = "tickerboy_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# IAM Policy for DynamoDB Access
resource "aws_iam_policy" "dynamodb_policy" {
  name = "tickerboy_dynamodb_policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "dynamodb:PutItem",
          "dynamodb:BatchWriteItem"
        ]
        Effect   = "Allow"
        Resource = aws_dynamodb_table.tickerboy_stock_data.arn
      }
    ]
  })
}

# Attach Policy to Role
resource "aws_iam_role_policy_attachment" "lambda_dynamodb_attachment" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.dynamodb_policy.arn
}



# DynamoDB Table Resource for Stock Data
resource "aws_dynamodb_table" "tickerboy_stock_data" {
  name         = "tickerboy_stock_data"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "Symbol"

  attribute {
    name = "Symbol"
    type = "S"
  }

  attribute {
    name = "Sector"
    type = "S"
  }

  global_secondary_index {
    name            = "SectorIndex"
    hash_key        = "Sector"
    projection_type = "ALL"
  }

  tags = {
    Name        = "TickerboyStockData"
    Environment = "production"
  }
}

# Lambda Function Resource
resource "aws_lambda_function" "tickerboy_lambda" {
  function_name = "tickerboy_lambda"

  filename         = "lambda_function.zip"
  source_code_hash = filebase64sha256("lambda_function.zip")

  runtime = "python3.9"
  handler = "lambda_function.lambda_handler"


  role        = aws_iam_role.lambda_role.arn
  timeout     = 300
  memory_size = 512

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.tickerboy_stock_data.name
    }
  }
}


# CloudWatch Event Rule to Trigger Lambda Monthly
resource "aws_cloudwatch_event_rule" "monthly_trigger" {
  name                = "tickerboy_lambda_monthly_trigger"
  description         = "Triggers Tickerboy Lambda function monthly"
  schedule_expression = "cron(0 0 1 * ? *)" # Run at midnight on the 1st of every month
}

# CloudWatch Event Target (Lambda)
resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.monthly_trigger.name
  target_id = "lambda"
  arn       = aws_lambda_function.tickerboy_lambda.arn
}

# Lambda Permission for CloudWatch Events
resource "aws_lambda_permission" "allow_cloudwatch_invocation" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.tickerboy_lambda.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.monthly_trigger.arn
}
