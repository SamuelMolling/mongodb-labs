import time
import os
from datetime import datetime
from pymongo import MongoClient, errors
from pymongo.encryption import ClientEncryption
from bson import Binary, Decimal128
from bson.codec_options import CodecOptions
from bson.decimal128 import create_decimal128_context
from bson.binary import UUID_SUBTYPE


def load_local_master_key(filename):
    if not os.path.exists(filename):
        key = "5MxTVQxEhvN4SC+URUTg5JE5aIRe6lJKX+Iz/05TnSe4xlcDv5nzX8bM043z1VY6v09x20NYhXukk9M+x1uOmOISeUUyhLLYmysuzb26RyraD5L1KV1IaaQI+k9cOMB4"
        with open(filename, "w") as f:
            f.write(key)
    with open(filename, "r") as f:
        return f.read()

# Conexão com MongoDB
def connect_mongo(uri):
    try:
        client = MongoClient(uri)
        return client
    except errors.ConnectionFailure as e:
        print(f"Error connecting to MongoDB: {e}")
        raise

# Configuração de KMS Providers
def setup_kms_providers(local_master_key):
    return {
        "local": {
            "key": local_master_key
        }
    }

def setup_client_encryption(client, kms_providers, key_vault_namespace):
    # Configurações do CodecOptions
    codec_options = CodecOptions()

    # Criação do ClientEncryption
    client_encryption = ClientEncryption(
        kms_providers=kms_providers,
        key_vault_namespace=key_vault_namespace,
        key_vault_client=client,
        codec_options=codec_options  # Adicionando CodecOptions correto
    )
    return client_encryption

# Criar índice no keyVault se não existir
def ensure_key_vault_index(key_vault_coll):
    index_name = "keyAltNames_1"
    indexes = key_vault_coll.index_information()
    if index_name not in indexes:
        key_vault_coll.create_index(
            [("keyAltNames", 1)], unique=True, partialFilterExpression={"keyAltNames": {"$exists": True}}
        )
        print("Index created in key vault.")
    else:
        print("Index already exists in key vault.")

# Criar data key no keyVault
def ensure_data_key(client_encryption, key_vault_coll, key_alt_name):
    existing_key = key_vault_coll.find_one({"keyAltNames": key_alt_name})
    if existing_key:
        print("Data key already exists. Reusing existing key.")
        return existing_key["_id"]

    print("Creating new data key.")
    data_key_id = client_encryption.create_data_key("local", key_alt_names=[key_alt_name])
    return data_key_id

# Criptografar salário
def encrypt_salary(client_encryption, data_key_id, salary):
    salary_in_cents = int(salary * 100)
    encrypted_salary = client_encryption.encrypt(
        value=salary_in_cents,
        algorithm="AEAD_AES_256_CBC_HMAC_SHA_512-Deterministic",
        key_id=data_key_id
    )
    return encrypted_salary

# Inserir documento no MongoDB
def insert_employee_doc(coll, name, position, company, salary_encrypted, currency, start_date):
    employee_doc = {
        "name": name,
        "position": position,
        "company": company,
        "salary": salary_encrypted,
        "currency": currency,
        "startDate": start_date
    }
    coll.insert_one(employee_doc)

# Buscar e descriptografar salários
def find_all_and_decrypt_salaries(coll, client_encryption):
    for doc in coll.find():
        encrypted_salary = doc["salary"]
        decrypted_salary = client_encryption.decrypt(encrypted_salary)
        salary_in_dollars = decrypted_salary / 100.0
        print(f"Employee: {doc['name']}, Salary: {salary_in_dollars} USD")

# Buscar documentos sem descriptografia
def find_all_without_decryption(coll):
    for doc in coll.find():
        print(f"Employee: {doc['name']}, Encrypted Salary: {doc['salary']}")

# Main
if __name__ == "__main__":
    uri = "mongodb+srv://llm-bot:llm-bot@cluster0.ag6bk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
    local_master_key_file = "local_master_key.txt"
    local_master_key = load_local_master_key(local_master_key_file)
    kms_providers = setup_kms_providers(local_master_key)
    key_vault_namespace = "encryption.__keyVault"

    client = connect_mongo(uri)
    database_name = "employee_data"
    collection_name = "employee_salary"
    coll = client[database_name][collection_name]
    coll.drop()
    key_vault_coll = client["encryption"]["__keyVault"]
    ensure_key_vault_index(key_vault_coll)

    client_encryption = setup_client_encryption(client, kms_providers, key_vault_namespace)

    data_key_id = ensure_data_key(client_encryption, key_vault_coll, "python_encryption_example")

    employees = [
        {"name": "Alice Johnson", "position": "Software Engineer", "company": "MongoDB", "salary": 50000, "currency": "USD", "start_date": datetime(2007, 2, 3)},
        {"name": "Bob Smith", "position": "Product Manager", "company": "MongoDB", "salary": 70000, "currency": "USD", "start_date": datetime(2009, 3, 14)},
    ]

    for emp in employees:
        encrypted_salary = encrypt_salary(client_encryption, data_key_id, emp["salary"])
        insert_employee_doc(coll, emp["name"], emp["position"], emp["company"], encrypted_salary, emp["currency"], emp["start_date"])

    print("\nDecrypted salaries:")
    find_all_and_decrypt_salaries(coll, client_encryption)

    print("\nWithout decryption:")
    find_all_without_decryption(coll)
