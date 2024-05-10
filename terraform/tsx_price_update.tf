# lambda_2.tf

# Lambda Function Resource to Fetch and Update Stock Prices
resource "aws_lambda_function" "price_update_lambda" {
  function_name = "tickerboy_price_update_lambda"

  filename         = "lambda_function_2.zip"
  source_code_hash = filebase64sha256("lambda_function_2.zip")

  runtime = "python3.9"
  handler = "lambda_function_2.lambda_handler"

  role        = aws_iam_role.lambda_role.arn
  timeout     = 300
  memory_size = 512

  environment {
    variables = {
      TABLE_NAME = aws_dynamodb_table.tickerboy_stock_data.name
    }
  }
}

# CloudWatch Event Rule to Trigger Lambda (e.g., Daily)
resource "aws_cloudwatch_event_rule" "daily_trigger" {
  name                = "tickerboy_price_update_lambda_daily_trigger"
  description         = "Triggers Tickerboy price update Lambda function daily"
  schedule_expression = "cron(0 18 ? * MON-FRI *)" # Run at 6 PM EST on weekdays
}

# CloudWatch Event Target (Lambda)
resource "aws_cloudwatch_event_target" "price_update_lambda_target" {
  rule      = aws_cloudwatch_event_rule.daily_trigger.name
  target_id = "lambda"
  arn       = aws_lambda_function.price_update_lambda.arn
}

# Lambda Permission for CloudWatch Events
resource "aws_lambda_permission" "allow_price_update_cloudwatch_invocation" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.price_update_lambda.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_trigger.arn
}

# IAM Policy to Allow Lambda to Read SSM Parameter
resource "aws_iam_policy" "ssm_parameter_policy" {
  name        = "tickerboy_ssm_parameter_policy"
  description = "Allows Lambda to read SSM parameter 'alphavantage_api'"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "ssm:GetParameter"
        ]
        Effect   = "Allow"
        Resource = "arn:aws:ssm:us-east-1:*:parameter/alphavantage_api" # Updated to reference Systems Manager Parameter Store
      },
    ]
  })
}

# Attach SSM Parameter Policy to the Lambda Role
resource "aws_iam_role_policy_attachment" "ssm_parameter_attachment" {
  role       = aws_iam_role.lambda_role.name
  policy_arn = aws_iam_policy.ssm_parameter_policy.arn
}