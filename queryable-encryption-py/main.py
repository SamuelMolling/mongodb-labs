from pymongo import MongoClient, errors
from pymongo.encryption_options import AutoEncryptionOpts
from bson import json_util
import os
import json
import datetime

# Modelo para EmployeeDocument
class EmployeeDocument:
    def __init__(self, name, position, company, salary, currency, start_date):
        self.name = name
        self.position = position
        self.company = company
        self.salary = salary
        self.currency = currency
        self.start_date = start_date

def load_local_master_key(filename):
    if not os.path.exists(filename):
        key = "5MxTVQxEhvN4SC+URUTg5JE5aIRe6lJKX+Iz/05TnSe4xlcDv5nzX8bM043z1VY6v09x20NYhXukk9M+x1uOmOISeUUyhLLYmysuzb26RyraD5L1KV1IaaQI+k9cOMB4"
        with open(filename, "w") as f:
            f.write(key)
    with open(filename, "r") as f:
        return f.read()

def get_encrypted_fields_map():
    return {
        "fields": [
            {
                "keyId": None,
                "path": "name",
                "bsonType": "string",
                "queries": [{"queryType": "equality"}],
            },
            {
                "keyId": None,
                "path": "salary",
                "bsonType": "int",
                "queries": [{"queryType": "range", "min": 0, "max": 1000000}],
            },
        ]
    }

def search_by_name(coll, name):
    filter = {"name": name}
    cursor = coll.find(filter)
    print(f"Documents with name '{name}':")
    for doc in cursor:
        print(json.dumps(doc, indent=4, default=json_util.default))

def search_by_salary_range(coll, min_salary, max_salary):
    filter = {"salary": {"$gte": min_salary, "$lte": max_salary}}
    cursor = coll.find(filter)
    print(f"Documents with salary between {min_salary} and {max_salary}:")
    for doc in cursor:
        print(json.dumps(doc, indent=4, default=json_util.default))

def main():
    uri = "<URI>"
    key_vault_namespace = "encryption.__keyVault"
    encrypted_database_name = "employee_data"
    encrypted_collection_name = "employee_salary"
    
    local_master_key_file = "local_master_key.txt"
    local_master_key = load_local_master_key(local_master_key_file)
    
    kms_providers = {"local": {"key": local_master_key}}
    encrypted_fields_map = get_encrypted_fields_map()
    
    auto_encryption_opts = AutoEncryptionOpts(
        kms_providers=kms_providers,
        key_vault_namespace=key_vault_namespace,
        crypt_shared_lib_path="./mongo_crypt_shared_v1-macos-arm64-enterprise-8.0.3/lib/mongo_crypt_v1.dylib",
        encrypted_fields_map=encrypted_fields_map,
    )
    
    client = MongoClient(uri, auto_encryption_opts=auto_encryption_opts)
    
    
    db = client[encrypted_database_name]
    collection = db[encrypted_collection_name]
    collection.drop()
    
    employees = [
        EmployeeDocument("Alice Johnson", "Software Engineer", "MongoDB", 100000, "USD", datetime.datetime(2019, 3, 5)),
        EmployeeDocument("Bob Smith", "Product Manager", "MongoDB", 150000, "USD", datetime.datetime(2018, 6, 15)),
        EmployeeDocument("Charlie Brown", "Data Analyst", "MongoDB", 200000, "USD", datetime.datetime(2020, 4, 20)),
        EmployeeDocument("Diana Prince", "HR Specialist", "MongoDB", 250000, "USD", datetime.datetime(2021, 12, 3)),
        EmployeeDocument("Evan Peters", "Marketing Coordinator", "MongoDB", 80000, "USD", datetime.datetime(2022, 10, 7)),
    ]
    
    for employee in employees:
        collection.insert_one(employee.__dict__)
        print(f"Inserted document for {employee.name}")
    
    search_by_name(collection, "Alice Johnson")
    search_by_salary_range(collection, 150000, 200000)

if __name__ == "__main__":
    main()
